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
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * IncidentCustomFieldSettingsCard: which incident custom fields are asked
 * for when an incident is created, for an incident template ("Custom Fields
 * on Create") or an incident form ("Questions").
 *
 * Only the network, the permission gate and the translation lookup are
 * stubbed: the card, its modal, the form and its dropdowns are the real
 * ones, so a save is made the way a person makes it - open the dropdown,
 * pick an option, press Save.
 */

let mockTranslate: (value: string) => string = (value: string): string => {
  return value;
};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return typeof value === "string" && value
            ? mockTranslate(value)
            : value;
        },
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" && value
            ? mockTranslate(value)
            : value;
        },
      };
    },
  };
});

/*
 * A refused request is written as an async function that throws, not as
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * the card's awaits adopt a microtask late, so a rejected one is reported as
 * unhandled although the card catches it. An async function's promise is a
 * native one.
 */
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import IncidentCustomFieldSettingsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldSettingsCard";
import IncidentCustomFieldCreateSettingsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldCreateSettingsCopy";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import CustomFieldMappingSourceResource from "../../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000aa";
const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000ff";

function customField(
  overrides: Partial<IncidentCustomField> & { name: string },
): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field.customFieldType = CustomFieldType.Text;
  Object.assign(field, overrides);
  return field;
}

// Shown and required on its own.
const IMPACT: IncidentCustomField = customField({
  name: "Impact",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "Low\nHigh",
  showOnCreate: true,
  isRequiredOnCreate: true,
  sortOrder: 1,
  variableKey: "impact",
});
// Shown, not required.
const DURATION: IncidentCustomField = customField({
  name: "Estimated Duration",
  customFieldType: CustomFieldType.Number,
  showOnCreate: true,
  sortOrder: 2,
  variableKey: "estimated_duration",
});
// Not shown on its own.
const CATEGORY: IncidentCustomField = customField({
  name: "Category",
  sortOrder: 3,
  variableKey: "category",
});
// Older than template variable keys: it can have no setting.
const LEGACY: IncidentCustomField = customField({
  name: "Legacy",
  showOnCreate: true,
  sortOrder: 4,
});
// Copied from the monitor field of the same name once there is a monitor.
const VENDOR: IncidentCustomField = customField({
  name: "Vendor",
  sortOrder: 6,
  variableKey: "vendor",
  mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
  mapFromCustomFieldName: "Vendor",
});

let definitions: Array<IncidentCustomField> | Error = [];
let storedSettings: JSONObject | null | undefined = undefined;
let recordFound: boolean = true;
let gate: PermissionGateResult = { isAllowed: true };

function listResult(data: Array<IncidentCustomField>): JSONObject {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

beforeEach(() => {
  mockTranslate = (value: string): string => {
    return value;
  };
  definitions = [IMPACT, DURATION, CATEGORY, LEGACY];
  storedSettings = undefined;
  recordFound = true;
  gate = { isAllowed: true };

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    if (definitions instanceof Error) {
      throw definitions;
    }

    return listResult(definitions);
  });

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (...args: Array<unknown>) => {
    if (!recordFound) {
      return null;
    }

    const request: { modelType: new () => IncidentTemplate | IncidentForm } =
      args[0] as { modelType: new () => IncidentTemplate | IncidentForm };
    const record: IncidentTemplate | IncidentForm = new request.modelType();

    if (storedSettings !== undefined) {
      record.customFieldSettings = storedSettings as JSONObject;
    }

    return record;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(() => {
    return new ObjectID(PROJECT_ID);
  });
  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation((): PermissionGateResult => {
      return gate;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderTemplateCard(
  props: { title?: string; description?: string } = {},
): Promise<RenderResult> {
  let result: RenderResult | undefined;

  await act(async (): Promise<void> => {
    result = render(
      <MemoryRouter>
        <IncidentCustomFieldSettingsCard
          mode="template"
          modelType={IncidentTemplate}
          modelId={new ObjectID(TEMPLATE_ID)}
          {...props}
        />
      </MemoryRouter>,
    );
  });

  return result!;
}

async function renderFormCard(): Promise<RenderResult> {
  let result: RenderResult | undefined;

  await act(async (): Promise<void> => {
    result = render(
      <MemoryRouter>
        <IncidentCustomFieldSettingsCard
          mode="form"
          modelType={IncidentForm}
          modelId={new ObjectID(FORM_ID)}
        />
      </MemoryRouter>,
    );
  });

  return result!;
}

function row(variableKey: string): HTMLElement {
  return screen.getByTestId(`incident-custom-field-setting-${variableKey}`);
}

function settingShownFor(variableKey: string): string {
  return (
    within(row(variableKey)).getByTestId("incident-custom-field-setting-value")
      .textContent || ""
  );
}

function projectDefaultShownFor(variableKey: string): string | null {
  const element: HTMLElement | null = within(row(variableKey)).queryByTestId(
    "incident-custom-field-project-default",
  );

  return element ? element.textContent || "" : null;
}

function listedKeys(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid^="incident-custom-field-setting-"]:not([data-testid="incident-custom-field-setting-value"])',
    ),
  ).map((element: HTMLElement): string => {
    return (element.getAttribute("data-testid") || "").replace(
      "incident-custom-field-setting-",
      "",
    );
  });
}

function editButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: name });
}

// Presses Edit: the modal opens at once, on a loader while it reads.
async function startEditing(name: string): Promise<HTMLElement> {
  fireEvent.click(editButton(name));
  return await screen.findByRole("dialog");
}

/*
 * Presses Edit, and waits for the modal's read to answer: for its dropdowns,
 * or for the banner saying why there are none.
 */
async function openEditor(name: string): Promise<HTMLElement> {
  const dialog: HTMLElement = await startEditing(name);

  await waitFor(() => {
    expect(within(dialog).queryByTestId("component-loader")).toBeNull();
    expect(
      within(dialog).queryAllByRole("combobox").length +
        within(dialog).queryAllByRole("alert").length,
    ).toBeGreaterThan(0);
  });

  return dialog;
}

function combobox(fieldName: string): HTMLElement {
  return within(screen.getByRole("dialog")).getByRole("combobox", {
    name: new RegExp(`^${fieldName}`),
  });
}

// Opens a field's dropdown and returns the labels of its options.
function optionsOf(fieldName: string): Array<string> {
  fireEvent.keyDown(combobox(fieldName), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  const options: Array<string> = Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__option"),
  ).map((element: HTMLElement): string => {
    return element.textContent || "";
  });

  fireEvent.keyDown(combobox(fieldName), { key: "Escape", code: "Escape" });

  return options;
}

function choose(fieldName: string, label: string): void {
  fireEvent.keyDown(combobox(fieldName), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  const option: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__option"),
  ).find((element: HTMLElement): boolean => {
    return element.textContent === label;
  });

  expect(option).toBeDefined();
  fireEvent.click(option!);
}

function selectedIn(fieldName: string): string {
  const control: HTMLElement | null = combobox(fieldName).closest(
    ".ou-select__control",
  );

  return (
    control?.querySelector<HTMLElement>(".ou-select__single-value")
      ?.textContent || ""
  );
}

async function save(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
}

function savedSettings(): JSONObject {
  const request: { data: JSONObject } = updateByIdMock.mock.calls[0]![0] as {
    data: JSONObject;
  };

  return request.data["customFieldSettings"] as JSONObject;
}

describe("an incident template's Custom Fields on Create card", () => {
  test("lists every field with a template variable key, in order, with its type and setting", async () => {
    storedSettings = { category: "Required", estimated_duration: "Hidden" };

    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    expect(listedKeys()).toEqual(["impact", "estimated_duration", "category"]);

    expect(within(row("impact")).getByText("Impact")).toBeInTheDocument();
    expect(
      within(row("impact")).getByText("Dropdown (single select)"),
    ).toBeInTheDocument();
    expect(settingShownFor("impact")).toBe("Default (Required)");

    expect(within(row("estimated_duration")).getByText("Number")).toBeTruthy();
    expect(settingShownFor("estimated_duration")).toBe("Hidden");

    expect(within(row("category")).getByText("Text")).toBeTruthy();
    expect(settingShownFor("category")).toBe("Required");

    // A field with no key cannot have a setting, so it is not offered one.
    expect(screen.queryByText("Legacy")).not.toBeInTheDocument();
  });

  test("Default names what each field does on its own", async () => {
    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    expect(settingShownFor("impact")).toBe("Default (Required)");
    expect(settingShownFor("estimated_duration")).toBe("Default (Optional)");
    expect(settingShownFor("category")).toBe("Default (Not Shown)");
  });

  test("a stored entry that is not a setting reads as Default", async () => {
    storedSettings = { impact: "required", category: 5 } as JSONObject;

    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    expect(settingShownFor("impact")).toBe("Default (Required)");
    expect(settingShownFor("category")).toBe("Default (Not Shown)");
  });

  test("the fields the template changes stand out from the ones it leaves on Default", async () => {
    storedSettings = { category: "Hidden" };

    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    const changed: HTMLElement = within(row("category")).getByTestId(
      "incident-custom-field-setting-value",
    );
    const leftAlone: HTMLElement = within(row("impact")).getByTestId(
      "incident-custom-field-setting-value",
    );

    expect(changed.className).toContain("bg-indigo-50");
    expect(leftAlone.className).toContain("bg-gray-50");
    expect(leftAlone.className).not.toContain("bg-indigo-50");
  });

  test("says what it is for, in the glossary's words", async () => {
    await renderTemplateCard();

    expect(
      await screen.findByText(
        IncidentCustomFieldCreateSettingsCopy.templateTitle,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        IncidentCustomFieldCreateSettingsCopy.templateDescription,
      ),
    ).toBeInTheDocument();
    expect(IncidentCustomFieldCreateSettingsCopy.templateTitle).toBe(
      "Custom Fields on Create",
    );
    expect(IncidentCustomFieldCreateSettingsCopy.templateDescription).toBe(
      "Choose which custom fields the Details step asks for when an incident is declared from this template, and which of them must be filled in. Fields left on Default follow their own Show on Create and Required on Create settings.",
    );
  });

  test("a title and description given to it replace its own", async () => {
    await renderTemplateCard({
      title: "Asked When Declaring",
      description: "Pick the questions.",
    });

    expect(await screen.findByText("Asked When Declaring")).toBeTruthy();
    expect(screen.getByText("Pick the questions.")).toBeTruthy();
    expect(screen.queryByText("Custom Fields on Create")).toBeNull();
  });

  test("reads the project's fields and the template's settings, and nothing more of the template", async () => {
    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    expect(getListMock).toHaveBeenCalledTimes(1);
    const listRequest: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;
    expect(listRequest["modelType"]).toBe(IncidentCustomField);
    expect(String((listRequest["query"] as JSONObject)["projectId"])).toBe(
      PROJECT_ID,
    );

    expect(getItemMock).toHaveBeenCalledTimes(1);
    const itemRequest: JSONObject = getItemMock.mock.calls[0]![0] as JSONObject;
    expect(itemRequest["modelType"]).toBe(IncidentTemplate);
    expect(String(itemRequest["id"])).toBe(TEMPLATE_ID);
    expect(itemRequest["select"]).toEqual({ customFieldSettings: true });
  });

  test("shows nothing while it loads", async () => {
    getListMock.mockImplementation((): Promise<never> => {
      return new Promise<never>(() => {
        // Never answers.
      });
    });

    const result: RenderResult = await renderTemplateCard();

    expect(result.container).toBeEmptyDOMElement();
  });

  test("shows nothing to a project with no incident custom fields", async () => {
    definitions = [];

    const result: RenderResult = await renderTemplateCard();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(result.container).toBeEmptyDOMElement();
  });

  test("shows nothing when no field has a template variable key", async () => {
    definitions = [LEGACY];

    const result: RenderResult = await renderTemplateCard();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(result.container).toBeEmptyDOMElement();
  });

  test("shows nothing when the fields cannot be read - custom fields not on the plan, say", async () => {
    definitions = new Error("Custom fields are not on your plan.");

    const result: RenderResult = await renderTemplateCard();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(result.container).toBeEmptyDOMElement();
    expect(
      screen.queryByText("Custom fields are not on your plan."),
    ).toBeNull();
  });

  test("shows nothing when the template cannot be read, or is gone", async () => {
    getItemMock.mockImplementation(async (): Promise<never> => {
      throw new Error("Forbidden");
    });

    const failed: RenderResult = await renderTemplateCard();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(failed.container).toBeEmptyDOMElement();

    cleanup();
    getItemMock.mockReset();
    getItemMock.mockResolvedValue(null as never);

    const missing: RenderResult = await renderTemplateCard();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(missing.container).toBeEmptyDOMElement();
  });

  test("the labels go through the translation lookup", async () => {
    mockTranslate = (value: string): string => {
      return `[de] ${value}`;
    };

    storedSettings = { category: "Optional" };

    await renderTemplateCard();

    expect(
      await screen.findByText("[de] Custom Fields on Create"),
    ).toBeInTheDocument();
    expect(settingShownFor("impact")).toBe("[de] Default (Required)");
    expect(
      within(row("impact")).getByText("[de] Dropdown (single select)"),
    ).toBeInTheDocument();
    expect(projectDefaultShownFor("category")).toBe(
      "[de] Project default: Not Shown",
    );
    // A field's name is the project's own text.
    expect(within(row("impact")).getByText("Impact")).toBeInTheDocument();
  });

  /*
   * A field the template overrides no longer shows the project's behaviour
   * in its setting, and a viewer cannot open the editor where Default spells
   * it out: whether the template relaxes a field the project requires, or
   * asks one the project leaves out, is said on the card.
   */
  test("a field the template overrides names the project default beside it, for a viewer too", async () => {
    storedSettings = {
      impact: "Optional",
      estimated_duration: "Hidden",
      category: "Required",
    };
    gate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Incident Template.",
    };

    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    expect(editButton("Edit Custom Fields on Create")).toBeDisabled();

    // Relaxed: the project requires it.
    expect(settingShownFor("impact")).toBe("Optional");
    expect(projectDefaultShownFor("impact")).toBe("Project default: Required");

    expect(settingShownFor("estimated_duration")).toBe("Hidden");
    expect(projectDefaultShownFor("estimated_duration")).toBe(
      "Project default: Optional",
    );

    // Asked: the project leaves it out.
    expect(settingShownFor("category")).toBe("Required");
    expect(projectDefaultShownFor("category")).toBe(
      "Project default: Not Shown",
    );

    // Still one row per field.
    expect(listedKeys()).toEqual(["impact", "estimated_duration", "category"]);
  });

  test("a field left on Default says it once, in its setting", async () => {
    storedSettings = { category: "Required", impact: "Default" };

    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    expect(settingShownFor("impact")).toBe("Default (Required)");
    expect(projectDefaultShownFor("impact")).toBeNull();
    expect(projectDefaultShownFor("estimated_duration")).toBeNull();
    expect(projectDefaultShownFor("category")).toBe(
      "Project default: Not Shown",
    );
  });

  test("a field copied from a monitor has no note on a template, whose Details step leaves it out once there is a monitor", async () => {
    definitions = [IMPACT, VENDOR];

    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    expect(
      document.querySelectorAll(
        '[data-testid="incident-custom-field-question-note"]',
      ),
    ).toHaveLength(0);

    const dialog: HTMLElement = await openEditor(
      "Edit Custom Fields on Create",
    );

    expect(
      within(dialog).queryByTestId("incident-custom-field-question-note"),
    ).toBeNull();
  });

  test("a saved override names the project default at once", async () => {
    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    choose("Impact", "Optional");

    await save();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(settingShownFor("impact")).toBe("Optional");
    expect(projectDefaultShownFor("impact")).toBe("Project default: Required");
  });
});

describe("editing a template's Custom Fields on Create", () => {
  test("offers Default - saying what the field does on its own - Required, Optional and Hidden", async () => {
    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    expect(optionsOf("Impact")).toEqual([
      "Default (Required)",
      "Required",
      "Optional",
      "Hidden",
    ]);
    expect(optionsOf("Category")).toEqual([
      "Default (Not Shown)",
      "Required",
      "Optional",
      "Hidden",
    ]);
    expect(
      within(screen.getByRole("dialog")).queryByRole("combobox", {
        name: /^Legacy/,
      }),
    ).toBeNull();
  });

  test("each dropdown starts on the field's setting", async () => {
    storedSettings = { category: "Optional" };

    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    await waitFor(() => {
      expect(selectedIn("Category")).toBe("Optional");
    });
    expect(selectedIn("Impact")).toBe("Default (Required)");
    expect(selectedIn("Estimated Duration")).toBe("Default (Optional)");
  });

  test("saves only what the template changes, and shows it", async () => {
    storedSettings = { category: "Required" };

    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    choose("Impact", "Hidden");
    choose("Estimated Duration", "Required");
    // Back to Default: nothing to store for it.
    choose("Category", "Default (Not Shown)");

    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const request: JSONObject = updateByIdMock.mock.calls[0]![0] as JSONObject;
    expect(request["modelType"]).toBe(IncidentTemplate);
    expect(String(request["id"])).toBe(TEMPLATE_ID);
    expect(request["data"]).toEqual({
      customFieldSettings: { impact: "Hidden", estimated_duration: "Required" },
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(settingShownFor("impact")).toBe("Hidden");
    expect(settingShownFor("estimated_duration")).toBe("Required");
    expect(settingShownFor("category")).toBe("Default (Not Shown)");
    /*
     * Read when the card loaded, when Edit opened and right before the save.
     * The server stores what it is sent, so nothing is read after it.
     */
    expect(getItemMock).toHaveBeenCalledTimes(3);
  });

  test("everything back on Default saves an empty object", async () => {
    storedSettings = { impact: "Optional" };

    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    choose("Impact", "Default (Required)");

    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedSettings()).toEqual({});
  });

  test("keeps the setting of a field it does not list, and drops entries the server would refuse", async () => {
    storedSettings = {
      deleted_field: "Required",
      "Not A Key": "Hidden",
      category: "sometimes",
    };

    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    choose("Impact", "Optional");

    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedSettings()).toEqual({
      deleted_field: "Required",
      impact: "Optional",
    });
  });

  test("a refused save keeps the modal open, with the reason and the choices just made", async () => {
    updateByIdMock.mockImplementation(async (): Promise<never> => {
      throw new Error("Custom Field Settings must be an object.");
    });

    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    choose("Impact", "Hidden");

    await save();

    expect(
      await screen.findByText("Custom Field Settings must be an object."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await waitFor(() => {
      expect(selectedIn("Impact")).toBe("Hidden");
    });

    // Nothing was saved, so the card still shows what is stored.
    expect(settingShownFor("impact")).toBe("Default (Required)");
  });

  test("a retry after a refused save goes through", async () => {
    updateByIdMock.mockImplementationOnce(async (): Promise<never> => {
      throw new Error("Try again.");
    });

    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    choose("Impact", "Hidden");

    await save();

    await screen.findByText("Try again.");

    await save();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(
      (updateByIdMock.mock.calls[1]![0] as { data: JSONObject }).data,
    ).toEqual({ customFieldSettings: { impact: "Hidden" } });
    expect(settingShownFor("impact")).toBe("Hidden");
  });

  test("closing the modal saves nothing", async () => {
    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    choose("Impact", "Hidden");

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(settingShownFor("impact")).toBe("Default (Required)");
  });
});

/*
 * The page may have been open for a while when somebody presses Edit, and
 * another admin, another tab, the API or Terraform may have changed the
 * settings since. What the modal starts from, and what a save writes, is
 * read again - and a save writes only the dropdowns changed in the modal.
 */
describe("editing from what is stored now, not what the page loaded", () => {
  test("Edit reads the fields and the settings again, and starts from them", async () => {
    storedSettings = {};

    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    // Another admin hides Impact, and adds a field, after the page loaded.
    storedSettings = { impact: "Hidden" };
    definitions = [
      IMPACT,
      DURATION,
      CATEGORY,
      customField({
        name: "Root Cause",
        sortOrder: 5,
        variableKey: "root_cause",
      }),
    ];

    await openEditor("Edit Custom Fields on Create");

    await waitFor(() => {
      expect(selectedIn("Impact")).toBe("Hidden");
    });
    expect(selectedIn("Root Cause")).toBe("Default (Not Shown)");

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(getItemMock).toHaveBeenCalledTimes(2);
    const reread: JSONObject = getItemMock.mock.calls[1]![0] as JSONObject;
    expect(reread["modelType"]).toBe(IncidentTemplate);
    expect(String(reread["id"])).toBe(TEMPLATE_ID);
    expect(reread["select"]).toEqual({ customFieldSettings: true });

    // The card behind the modal shows what was read, too.
    expect(settingShownFor("impact")).toBe("Hidden");
    expect(listedKeys()).toEqual([
      "impact",
      "estimated_duration",
      "category",
      "root_cause",
    ]);

    choose("Category", "Optional");

    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    // The other admin's Hidden is not put back to Default.
    expect(savedSettings()).toEqual({ impact: "Hidden", category: "Optional" });
  });

  test("a setting somebody saves while the modal is open is kept, unless this edit changes the same field", async () => {
    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    await waitFor(() => {
      expect(selectedIn("Impact")).toBe("Default (Required)");
    });

    // Saved by another admin after this modal opened.
    storedSettings = {
      estimated_duration: "Required",
      category: "Hidden",
      impact: "Optional",
    };

    choose("Impact", "Hidden");
    // Changed, then changed back: this edit has nothing to say about it.
    choose("Category", "Required");
    choose("Category", "Default (Not Shown)");

    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedSettings()).toEqual({
      impact: "Hidden",
      estimated_duration: "Required",
      category: "Hidden",
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // The card shows what was saved, the other admin's settings included.
    expect(settingShownFor("estimated_duration")).toBe("Required");
    expect(settingShownFor("category")).toBe("Hidden");
  });

  test("while Edit reads, the modal shows a loader and nothing can be saved", async () => {
    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    let answer: (record: IncidentTemplate) => void = (): void => {};

    getItemMock.mockImplementationOnce((): Promise<IncidentTemplate> => {
      return new Promise<IncidentTemplate>(
        (resolve: (record: IncidentTemplate) => void) => {
          answer = resolve;
        },
      );
    });

    const dialog: HTMLElement = await startEditing(
      "Edit Custom Fields on Create",
    );

    expect(within(dialog).getByTestId("component-loader")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();

    const stored: IncidentTemplate = new IncidentTemplate();
    stored.customFieldSettings = { impact: "Optional" };

    await act(async (): Promise<void> => {
      answer(stored);
    });

    await waitFor(() => {
      expect(selectedIn("Impact")).toBe("Optional");
    });
    expect(screen.getByTestId("modal-footer-submit-button")).not.toBeDisabled();
  });

  test("when Edit cannot read them, the modal says why, has nothing to save, and Try again reads them again", async () => {
    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    getItemMock.mockImplementationOnce(async (): Promise<never> => {
      throw new Error("The server could not be reached.");
    });

    const dialog: HTMLElement = await openEditor(
      "Edit Custom Fields on Create",
    );

    expect(
      await within(dialog).findByText("The server could not be reached."),
    ).toBeInTheDocument();
    // Nothing read, so nothing to choose from.
    expect(within(dialog).queryByRole("combobox")).toBeNull();

    const button: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    expect(button).toHaveTextContent("Try again");

    await act(async (): Promise<void> => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(selectedIn("Impact")).toBe("Default (Required)");
    });
    expect(screen.queryByText("The server could not be reached.")).toBeNull();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Save",
    );
    expect(getItemMock).toHaveBeenCalledTimes(3);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a template deleted since the page loaded is named as gone, in the template's words", async () => {
    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    recordFound = false;

    const dialog: HTMLElement = await openEditor(
      "Edit Custom Fields on Create",
    );

    expect(
      await within(dialog).findByText(
        IncidentCustomFieldCreateSettingsCopy.templateNotFound,
      ),
    ).toBeInTheDocument();
    expect(IncidentCustomFieldCreateSettingsCopy.templateNotFound).toBe(
      "This template's custom field settings could not be loaded. The template may have been deleted.",
    );
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a save that cannot read the settings first writes nothing, says why, and keeps the choices", async () => {
    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    await waitFor(() => {
      expect(selectedIn("Impact")).toBe("Default (Required)");
    });

    choose("Impact", "Hidden");

    getItemMock.mockImplementationOnce(async (): Promise<never> => {
      throw new Error("The server could not be reached.");
    });

    await save();

    expect(
      await screen.findByText("The server could not be reached."),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(selectedIn("Impact")).toBe("Hidden");
    });

    // Pressed again, it reads, then writes.
    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedSettings()).toEqual({ impact: "Hidden" });
  });

  test("a save finding the template gone writes nothing", async () => {
    await renderTemplateCard();

    await openEditor("Edit Custom Fields on Create");

    await waitFor(() => {
      expect(selectedIn("Impact")).toBe("Default (Required)");
    });

    choose("Impact", "Hidden");

    recordFound = false;

    await save();

    expect(
      await screen.findByText(
        IncidentCustomFieldCreateSettingsCopy.templateNotFound,
      ),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a read that answers after the modal was closed opens nothing", async () => {
    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    let answer: (record: IncidentTemplate) => void = (): void => {};

    getItemMock.mockImplementationOnce((): Promise<IncidentTemplate> => {
      return new Promise<IncidentTemplate>(
        (resolve: (record: IncidentTemplate) => void) => {
          answer = resolve;
        },
      );
    });

    await startEditing("Edit Custom Fields on Create");

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    const stored: IncidentTemplate = new IncidentTemplate();
    stored.customFieldSettings = { impact: "Optional" };

    await act(async (): Promise<void> => {
      answer(stored);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    // Nor does it change what the card shows.
    expect(settingShownFor("impact")).toBe("Default (Required)");
  });
});

describe("who may edit a template's Custom Fields on Create", () => {
  test("the gate is an update of the template", async () => {
    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    const call: Array<unknown> = (
      PermissionGate.check as unknown as {
        mock: { calls: Array<Array<unknown>> };
      }
    ).mock.calls[0]!;

    expect(call[0]).toBeInstanceOf(IncidentTemplate);
    expect(call[1]).toBe(ModelAction.Update);
  });

  test("without the permission, the button stays, disabled, and says why", async () => {
    gate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Incident Template.",
    };

    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    const button: HTMLElement = editButton("Edit Custom Fields on Create");

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("while the permissions are unknown, there is no button - the settings still show", async () => {
    gate = { isAllowed: false };

    await renderTemplateCard();

    await screen.findByText("Custom Fields on Create");

    expect(
      screen.queryByRole("button", { name: "Edit Custom Fields on Create" }),
    ).toBeNull();
    expect(settingShownFor("impact")).toBe("Default (Required)");
  });
});

describe("an incident form's Questions card", () => {
  test("lists every field as Not Asked until the form names it", async () => {
    storedSettings = {
      impact: "Required",
      estimated_duration: "Optional",
      // A form offers no Default, and does not ask a Hidden field.
      category: "Default",
    };

    await renderFormCard();

    expect(await screen.findByText("Questions")).toBeInTheDocument();
    expect(
      screen.getByText(IncidentCustomFieldCreateSettingsCopy.formDescription),
    ).toBeInTheDocument();

    expect(listedKeys()).toEqual(["impact", "estimated_duration", "category"]);
    expect(settingShownFor("impact")).toBe("Required");
    expect(settingShownFor("estimated_duration")).toBe("Optional");
    expect(settingShownFor("category")).toBe("Not Asked");
  });

  /*
   * The form does not ask such a field while its incident template attaches
   * monitors - the incident takes the monitor's value - so the card says
   * so where the question is set, rather than leave an admin wondering why
   * a Required question is never asked.
   */
  test("a field copied from a monitor says it is not asked while the template attaches monitors, on the card and in the editor", async () => {
    definitions = [IMPACT, VENDOR];
    storedSettings = { vendor: "Required" };

    await renderFormCard();

    await screen.findByText("Questions");

    expect(
      within(row("vendor")).getByTestId("incident-custom-field-question-note"),
    ).toHaveTextContent(
      IncidentCustomFieldCreateSettingsCopy.formCopiedFromMonitor,
    );
    expect(
      within(row("impact")).queryByTestId(
        "incident-custom-field-question-note",
      ),
    ).toBeNull();
    // Still one row per field, and still a question the form can ask.
    expect(listedKeys()).toEqual(["impact", "vendor"]);
    expect(settingShownFor("vendor")).toBe("Required");

    const dialog: HTMLElement = await openEditor("Edit Questions");

    const notes: Array<HTMLElement> = within(dialog).getAllByTestId(
      "incident-custom-field-question-note",
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(
      IncidentCustomFieldCreateSettingsCopy.formCopiedFromMonitor,
    );
    // Under its type, which the dropdown still names.
    expect(within(dialog).getByText("Text")).toBeInTheDocument();
    expect(optionsOf("Vendor")).toEqual(["Not Asked", "Optional", "Required"]);
    expect(selectedIn("Vendor")).toBe("Required");
  });

  test("the note goes through the translation lookup", async () => {
    mockTranslate = (value: string): string => {
      return `[de] ${value}`;
    };

    definitions = [IMPACT, VENDOR];

    await renderFormCard();

    await screen.findByText("[de] Questions");

    expect(
      within(row("vendor")).getByTestId("incident-custom-field-question-note"),
    ).toHaveTextContent(
      `[de] ${IncidentCustomFieldCreateSettingsCopy.formCopiedFromMonitor}`,
    );

    const dialog: HTMLElement = await openEditor("[de] Edit Questions");

    expect(
      within(dialog).getByTestId("incident-custom-field-question-note"),
    ).toHaveTextContent(
      `[de] ${IncidentCustomFieldCreateSettingsCopy.formCopiedFromMonitor}`,
    );
    expect(within(dialog).getByText("[de] Text")).toBeInTheDocument();
  });

  test("names no project default: a form does not follow the project's switches", async () => {
    storedSettings = { impact: "Optional", category: "Required" };

    await renderFormCard();

    await screen.findByText("Questions");

    expect(settingShownFor("impact")).toBe("Optional");
    expect(
      document.querySelectorAll(
        '[data-testid="incident-custom-field-project-default"]',
      ),
    ).toHaveLength(0);
  });

  test("a new form asks nothing, whatever the fields' own Show on Create says", async () => {
    await renderFormCard();

    await screen.findByText("Questions");

    expect(settingShownFor("impact")).toBe("Not Asked");
    expect(settingShownFor("estimated_duration")).toBe("Not Asked");
    expect(settingShownFor("category")).toBe("Not Asked");

    for (const variableKey of ["impact", "estimated_duration", "category"]) {
      expect(
        within(row(variableKey)).getByTestId(
          "incident-custom-field-setting-value",
        ).className,
      ).toContain("bg-gray-50");
    }
  });

  test("reads the form's settings", async () => {
    await renderFormCard();

    await screen.findByText("Questions");

    const itemRequest: JSONObject = getItemMock.mock.calls[0]![0] as JSONObject;
    expect(itemRequest["modelType"]).toBe(IncidentForm);
    expect(String(itemRequest["id"])).toBe(FORM_ID);
    expect(itemRequest["select"]).toEqual({ customFieldSettings: true });
  });

  test("shows a loader inside the card while it loads", async () => {
    getListMock.mockImplementation((): Promise<never> => {
      return new Promise<never>(() => {
        // Never answers.
      });
    });

    await renderFormCard();

    expect(screen.getByText("Questions")).toBeInTheDocument();
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Questions" })).toBeNull();
  });

  test("with no custom fields yet, says where they are made", async () => {
    definitions = [];

    await renderFormCard();

    expect(
      await screen.findByText("No incident custom fields yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This form can ask for incident custom fields once your project has some. Create them in Incidents > Settings > Custom Fields, then add them to the form here.",
      ),
    ).toBeInTheDocument();

    const link: HTMLElement = screen.getByText("Go to Custom Fields");
    expect(link.closest("a")!.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/incidents/settings/custom-fields`,
    );

    // Nothing to edit.
    expect(screen.queryByRole("button", { name: "Edit Questions" })).toBeNull();
  });

  test("fields without a template variable key count as none", async () => {
    definitions = [LEGACY];

    await renderFormCard();

    expect(
      await screen.findByText("No incident custom fields yet"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Legacy")).toBeNull();
  });

  test("says why when the fields cannot be read", async () => {
    definitions = new Error("Custom fields are not on your plan.");

    await renderFormCard();

    expect(
      await screen.findByText("Custom fields are not on your plan."),
    ).toBeInTheDocument();
    expect(screen.getByText("Questions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Questions" })).toBeNull();
  });

  test("says so when the form itself cannot be found", async () => {
    recordFound = false;

    await renderFormCard();

    expect(
      await screen.findByText(
        "This form's questions could not be loaded. The form may have been deleted.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Questions" })).toBeNull();
  });
});

describe("editing an incident form's questions", () => {
  test("offers Not Asked, Optional and Required, starting on each field's", async () => {
    storedSettings = { impact: "Required" };

    await renderFormCard();

    const dialog: HTMLElement = await openEditor("Edit Questions");

    expect(within(dialog).getByText("Edit Questions")).toBeInTheDocument();
    expect(optionsOf("Impact")).toEqual(["Not Asked", "Optional", "Required"]);
    expect(optionsOf("Category")).toEqual([
      "Not Asked",
      "Optional",
      "Required",
    ]);

    await waitFor(() => {
      expect(selectedIn("Impact")).toBe("Required");
    });
    expect(selectedIn("Category")).toBe("Not Asked");
  });

  test("saves only the questions the form asks", async () => {
    storedSettings = { impact: "Required", category: "Optional" };

    await renderFormCard();

    await openEditor("Edit Questions");

    choose("Estimated Duration", "Optional");
    choose("Category", "Not Asked");

    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const request: JSONObject = updateByIdMock.mock.calls[0]![0] as JSONObject;
    expect(request["modelType"]).toBe(IncidentForm);
    expect(String(request["id"])).toBe(FORM_ID);
    expect(savedSettings()).toEqual({
      impact: "Required",
      estimated_duration: "Optional",
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(settingShownFor("estimated_duration")).toBe("Optional");
    expect(settingShownFor("category")).toBe("Not Asked");
  });

  test("a question another admin removed since the page loaded stays off the form", async () => {
    storedSettings = { category: "Optional" };

    await renderFormCard();

    await screen.findByText("Questions");

    expect(settingShownFor("category")).toBe("Optional");

    // Another admin takes Category off the form.
    storedSettings = {};

    await openEditor("Edit Questions");

    await waitFor(() => {
      expect(selectedIn("Category")).toBe("Not Asked");
    });

    choose("Impact", "Required");

    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedSettings()).toEqual({ impact: "Required" });
  });

  test("a question removed while the modal is open stays off the form", async () => {
    storedSettings = { category: "Optional" };

    await renderFormCard();

    await openEditor("Edit Questions");

    await waitFor(() => {
      expect(selectedIn("Category")).toBe("Optional");
    });

    storedSettings = {};

    choose("Impact", "Required");

    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedSettings()).toEqual({ impact: "Required" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(settingShownFor("category")).toBe("Not Asked");
  });

  test("a form deleted since the page loaded is named as gone", async () => {
    await renderFormCard();

    await screen.findByText("Questions");

    recordFound = false;

    const dialog: HTMLElement = await openEditor("Edit Questions");

    expect(
      await within(dialog).findByText(
        "This form's questions could not be loaded. The form may have been deleted.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("drops the question of a field that is gone, so a field made again with its key is not asked at once", async () => {
    // "customer" was a field the form asked; it has since been deleted.
    storedSettings = { customer: "Required", impact: "Optional" };

    await renderFormCard();

    await openEditor("Edit Questions");

    choose("Category", "Optional");

    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedSettings()).toEqual({
      impact: "Optional",
      category: "Optional",
    });
  });

  test("the gate is an update of the form", async () => {
    await renderFormCard();

    await screen.findByText("Questions");

    const call: Array<unknown> = (
      PermissionGate.check as unknown as {
        mock: { calls: Array<Array<unknown>> };
      }
    ).mock.calls[0]!;

    expect(call[0]).toBeInstanceOf(IncidentForm);
    expect(call[1]).toBe(ModelAction.Update);
  });
});
