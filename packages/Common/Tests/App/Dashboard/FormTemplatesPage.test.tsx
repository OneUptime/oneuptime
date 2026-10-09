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
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A form's Templates page, drawn for real: what it reads, the list (what
 * each template fills in, the default marked, its own link), adding and
 * editing a template in an editor that is the form's own questions - hidden
 * ones too, none required - duplicating, moving and deleting one, a refused
 * save, a full form, and the read-only page.
 *
 * The network, the permission gate and the copy button are stubbed; the
 * rules behind the page are FormTemplatesState.test.ts's and
 * FormTemplate.test.ts's.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const loadCustomFieldsMock: MockFunction = getJestMockFunction();
const loadRecordOptionsMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderData",
  () => {
    return {
      __esModule: true,
      loadFormCustomFields: (...args: Array<unknown>): unknown => {
        return loadCustomFieldsMock(...args);
      },
      loadFormRecordOptions: (...args: Array<unknown>): unknown => {
        return loadRecordOptionsMock(...args);
      },
    };
  },
);

// What a template's Copy Link copies, readable without a clipboard.
jest.mock("../../../UI/Components/CopyTextButton/CopyTextButton", () => {
  return {
    __esModule: true,
    default: (props: {
      textToBeCopied: string;
      label?: string;
    }): ReactElement => {
      return React.createElement(
        "span",
        {
          "data-testid": "copy-link",
          "data-text": props.textToBeCopied,
        },
        props.label,
      );
    },
  };
});

// A plain text box in place of the rich editor, as the other dialogs' tests use.
jest.mock("../../../UI/Components/Markdown.tsx/MarkdownEditor", () => {
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (props: {
      initialValue?: string;
      onChange?: (value: string) => void;
    }): ReactElement => {
      const [value, setValue] = ReactModule.useState<string>(
        props.initialValue || "",
      );
      return ReactModule.createElement("textarea", {
        "aria-label": "Markdown",
        value: value,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
          setValue(event.target.value);
          props.onChange?.(event.target.value);
        },
      });
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

import FormTemplates from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Templates/FormTemplates";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import Form from "../../../Models/DatabaseModels/Form";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { FormField, FormFieldSource } from "../../../Types/Form/FormField";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import {
  FORM_MAX_TEMPLATES,
  FormTemplate,
  FormTemplateFieldSetting,
  isFormTemplateId,
} from "../../../Types/Form/FormTemplate";
import ObjectID from "../../../Types/ObjectID";
import { ACCOUNTS_URL } from "../../../UI/Config";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import userEvent from "@testing-library/user-event";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000dd";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000001";

const FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "Title",
    isRequired: true,
  },
  {
    id: "description",
    source: FormFieldSource.TargetField,
    targetField: "description",
    label: "Description",
    helpText: "What people are told.",
    isRequired: false,
    isHidden: true,
  },
  {
    id: "severity",
    source: FormFieldSource.TargetField,
    targetField: "incidentSeverityId",
    label: "Severity",
    isRequired: false,
  },
  {
    id: "office",
    source: FormFieldSource.Question,
    type: CustomFieldType.Dropdown,
    dropdownOptions: "Berlin\nLondon",
    label: "Office",
    isRequired: false,
  },
];

const OUTAGE: FormTemplate = {
  id: "outage",
  name: "Application Outage",
  answers: {
    title: "The application is down",
    description: "We are aware of an outage.",
    severity: SEVERITY_ID,
  },
};

const MAINTENANCE: FormTemplate = {
  id: "maintenance",
  name: "Planned Maintenance",
  isDefault: true,
  answers: { title: "Planned maintenance", office: "London" },
};

let storedTemplates: Array<FormTemplate> | null;
let storedFields: Array<FormField>;
let storedTarget: FormTargetType;
let stored: "missing" | Error | null;
let gate: PermissionGateResult;

beforeEach(() => {
  storedTemplates = [OUTAGE, MAINTENANCE];
  storedFields = FIELDS;
  storedTarget = FormTargetType.Incident;
  stored = null;
  gate = { isAllowed: true };

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (stored === "missing") {
      return null;
    }

    const form: Form = new Form();
    form._id = FORM_ID;
    form.name = "Department A";
    form.targetType = storedTarget;
    form.fields = JSON.parse(JSON.stringify(storedFields));
    form.templates = JSON.parse(JSON.stringify(storedTemplates));
    form.shareKey = new ObjectID(SHARE_KEY);
    return form;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  loadCustomFieldsMock.mockReset();
  loadCustomFieldsMock.mockResolvedValue([] as never);

  loadRecordOptionsMock.mockReset();
  loadRecordOptionsMock.mockImplementation(async (): Promise<unknown> => {
    return [{ id: SEVERITY_ID, name: "Critical" }];
  });

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <FormTemplates formId={new ObjectID(FORM_ID)} />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

function cardButton(title: string): HTMLElement {
  const button: HTMLElement | undefined = screen
    .queryAllByTestId("card-button")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes(title);
    });

  expect(button).toBeDefined();
  return button!;
}

function rowIds(): Array<string> {
  return Array.from(
    screen
      .getByTestId("form-templates-list")
      .querySelectorAll('li[data-testid^="form-template-"]'),
  ).map((element: Element): string => {
    return (element.getAttribute("data-testid") || "").replace(
      "form-template-",
      "",
    );
  });
}

function savedTemplates(call: number = 0): Array<FormTemplate> {
  const request: { data: { templates: Array<FormTemplate> } } = updateByIdMock
    .mock.calls[call]![0] as never;

  return request.data.templates;
}

async function saveDialog(): Promise<void> {
  await click(
    within(screen.getByTestId("modal")).getByTestId(
      "modal-footer-submit-button",
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

describe("loading", () => {
  test("reads the form's questions, templates and link - and the records its choices offer", async () => {
    await renderPage();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);
    expect(request["select"]).toEqual({
      name: true,
      targetType: true,
      fields: true,
      templates: true,
      shareKey: true,
    });
    expect(loadRecordOptionsMock).toHaveBeenCalledWith(
      FormTargetOptionsSource.IncidentSeverity,
    );
    // No question is linked to a custom field: none are read.
    expect(loadCustomFieldsMock).not.toHaveBeenCalled();
  });

  test("a form that cannot be loaded says so", async () => {
    stored = new Error("The network is down.");

    await renderPage();

    expect(screen.getByText("The network is down.")).toBeInTheDocument();
  });

  test("a form that is gone says so", async () => {
    stored = "missing";

    await renderPage();

    expect(screen.getByText(FormsCopy.formNotFound)).toBeInTheDocument();
  });
});

describe("the list", () => {
  test("lists the templates in the form's order, the default marked", async () => {
    await renderPage();

    expect(rowIds()).toEqual(["outage", "maintenance"]);
    expect(screen.getByTestId("form-template-name-outage")).toHaveTextContent(
      "Application Outage",
    );
    expect(
      screen.queryByTestId("form-template-default-outage"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("form-template-default-maintenance"),
    ).toHaveTextContent("Default");
  });

  test("says what each template fills in, hidden questions included", async () => {
    await renderPage();

    expect(
      screen.getByTestId("form-template-answers-outage"),
    ).toHaveTextContent(["Title", "Description", "Severity"].join(""));
    expect(
      screen.getByTestId("form-template-answers-maintenance"),
    ).toHaveTextContent(["Title", "Office"].join(""));
  });

  test("each template's link opens the form with it", async () => {
    await renderPage();

    expect(
      screen
        .getAllByTestId("copy-link")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-text");
        }),
    ).toEqual([
      `${ACCOUNTS_URL.toString()}/form/${SHARE_KEY}?template=outage`,
      `${ACCOUNTS_URL.toString()}/form/${SHARE_KEY}?template=maintenance`,
    ]);
  });

  test("a form with no templates says what they are for", async () => {
    storedTemplates = null;

    await renderPage();

    expect(screen.getByText(FormsCopy.templatesEmpty)).toBeInTheDocument();
    expect(screen.queryByTestId("form-templates-list")).not.toBeInTheDocument();
  });
});

describe("adding a template", () => {
  test("the editor is the form's own questions, hidden ones noted, none required", async () => {
    await renderPage();
    await click(cardButton(FormsCopy.addTemplate));

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      FormsCopy.addTemplate,
    );
    expect(within(dialog).getByTestId("modal-description")).toHaveTextContent(
      FormsCopy.templateEditorDescription,
    );
    expect(within(dialog).getByTestId("form-template-name")).toHaveValue("");
    expect(
      within(dialog).getByTestId("form-template-field-title"),
    ).toBeInTheDocument();
    // The hidden description is asked here: only templates answer it.
    expect(
      within(dialog).getByRole("textbox", { name: "Markdown" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("What people are told."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("form-template-hidden-note-description"),
    ).toHaveTextContent(FormsCopy.templateHiddenAnswerNote);
    // "(Optional)" on every question: a template need not answer any.
    expect(within(dialog).queryByText("Title *")).not.toBeInTheDocument();
  });

  test("saves the whole list, the new template at the end, and lists it", async () => {
    await renderPage();
    await click(cardButton(FormsCopy.addTemplate));

    fireEvent.change(screen.getByTestId("form-template-name"), {
      target: { value: "Service Restored" },
    });
    fireEvent.change(screen.getByTestId("form-template-field-title"), {
      target: { value: "Service restored" },
    });
    // A Markdown question: its editor is the stubbed text box.
    fireEvent.change(
      within(screen.getByTestId("modal")).getByRole("textbox", {
        name: "Markdown",
      }),
      { target: { value: "Everything works again." } },
    );

    await saveDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);

    const templates: Array<FormTemplate> = savedTemplates();

    expect(templates.slice(0, 2)).toEqual([OUTAGE, MAINTENANCE]);
    expect(isFormTemplateId(templates[2]!.id)).toBe(true);
    expect(templates[2]).toEqual({
      id: templates[2]!.id,
      name: "Service Restored",
      answers: {
        title: "Service restored",
        description: "Everything works again.",
      },
    });

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
    expect(rowIds()).toHaveLength(3);
  });

  test("a template needs a name: none is sent without one", async () => {
    await renderPage();
    await click(cardButton(FormsCopy.addTemplate));

    await saveDialog();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  test("a refused save keeps the dialog open with the server's words", async () => {
    updateByIdMock.mockRejectedValue(
      new Error(
        'Template 3 ("Application Outage") has the same name as another template.',
      ),
    );

    await renderPage();
    await click(cardButton(FormsCopy.addTemplate));

    fireEvent.change(screen.getByTestId("form-template-name"), {
      target: { value: "Application Outage" },
    });

    await saveDialog();

    await waitFor(() => {
      expect(
        within(screen.getByTestId("modal")).getByText(
          'Template 3 ("Application Outage") has the same name as another template.',
        ),
      ).toBeInTheDocument();
    });
    // Nothing changed on the list.
    expect(rowIds()).toEqual(["outage", "maintenance"]);
  });

  test("a full form adds no template", async () => {
    storedTemplates = Array.from(
      { length: FORM_MAX_TEMPLATES },
      (_value: unknown, index: number): FormTemplate => {
        return { id: `t${index}`, name: `Template ${index}`, answers: {} };
      },
    );

    await renderPage();

    expect(cardButton(FormsCopy.addTemplate)).toBeDisabled();
    expect(screen.getByTestId("form-template-duplicate-t0")).toBeDisabled();
  });
});

describe("changing a template", () => {
  test("Edit opens the editor filled in; saving keeps its id and its place", async () => {
    await renderPage();
    await click(screen.getByTestId("form-template-edit-outage"));

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      FormsCopy.editTemplate,
    );
    expect(screen.getByTestId("form-template-name")).toHaveValue(
      "Application Outage",
    );
    expect(screen.getByTestId("form-template-field-title")).toHaveValue(
      "The application is down",
    );

    fireEvent.change(screen.getByTestId("form-template-name"), {
      target: { value: "Outage (EU)" },
    });

    await saveDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const templates: Array<FormTemplate> = savedTemplates();

    expect(
      templates.map((template: FormTemplate): string => {
        return template.id;
      }),
    ).toEqual(["outage", "maintenance"]);
    expect(templates[0]).toEqual({ ...OUTAGE, name: "Outage (EU)" });
  });

  test("Duplicate copies a template right after it, named as a copy", async () => {
    await renderPage();
    await click(screen.getByTestId("form-template-duplicate-outage"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const templates: Array<FormTemplate> = savedTemplates();

    expect(
      templates.map((template: FormTemplate): string => {
        return template.name;
      }),
    ).toEqual([
      "Application Outage",
      "Application Outage 2",
      "Planned Maintenance",
    ]);
    expect(templates[1]!.answers).toEqual(OUTAGE.answers);
  });

  test("Move Down and Move Up save the new order", async () => {
    await renderPage();

    expect(screen.getByTestId("form-template-move-up-outage")).toBeDisabled();
    expect(
      screen.getByTestId("form-template-move-down-maintenance"),
    ).toBeDisabled();

    await click(screen.getByTestId("form-template-move-down-outage"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(
      savedTemplates().map((template: FormTemplate): string => {
        return template.id;
      }),
    ).toEqual(["maintenance", "outage"]);

    await waitFor(() => {
      expect(rowIds()).toEqual(["maintenance", "outage"]);
    });
  });

  test("Delete asks first, then removes it", async () => {
    await renderPage();
    await click(screen.getByTestId("form-template-delete-outage"));

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(dialog).toHaveTextContent(FormsCopy.deleteTemplateDescription);
    expect(updateByIdMock).not.toHaveBeenCalled();

    await click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedTemplates()).toEqual([MAINTENANCE]);

    await waitFor(() => {
      expect(rowIds()).toEqual(["maintenance"]);
    });
  });

  test("a change the server refuses is said over the list, and the list stays as it was", async () => {
    updateByIdMock.mockRejectedValue(new Error("You do not have permission."));

    await renderPage();
    await click(screen.getByTestId("form-template-move-down-outage"));

    await waitFor(() => {
      expect(screen.getByTestId("form-templates-error")).toHaveTextContent(
        "You do not have permission.",
      );
    });
    expect(rowIds()).toEqual(["outage", "maintenance"]);
  });
});

describe("the read-only page", () => {
  test("lists the templates and their links, offers no change, and says why", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You need permission to edit forms.",
    };

    await renderPage();

    expect(rowIds()).toEqual(["outage", "maintenance"]);
    expect(screen.getAllByTestId("copy-link")).toHaveLength(2);
    expect(screen.queryAllByTestId("card-button")).toHaveLength(0);
    expect(
      screen.queryByTestId("form-template-edit-outage"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("form-template-delete-outage"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("form-templates-read-only")).toHaveTextContent(
      "You need permission to edit forms.",
    );
  });
});

/*
 * How a template asks each question (issue #4563): the editor's Questions
 * rows - one per question, starting on the form's own setting - what they
 * save, the answers they mark as used as they are, and what the list says
 * each template changes.
 */
describe("how a template asks each question", () => {
  const Required: FormTemplateFieldSetting = FormTemplateFieldSetting.Required;
  const Optional: FormTemplateFieldSetting = FormTemplateFieldSetting.Optional;
  const Hidden: FormTemplateFieldSetting = FormTemplateFieldSetting.Hidden;

  function row(fieldId: string): HTMLElement {
    return within(screen.getByTestId("modal")).getByTestId(
      `form-template-setting-row-${fieldId}`,
    );
  }

  // The setting a row shows, as its picker reads.
  function shown(fieldId: string): string {
    return (
      row(fieldId).querySelector(".ou-select__single-value")?.textContent || ""
    );
  }

  async function choose(fieldId: string, label: string): Promise<void> {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(within(row(fieldId)).getByRole("combobox"));

    const menu: HTMLElement = await screen.findByRole("listbox");

    await user.click(within(menu).getByText(label, { exact: true }));
  }

  function hiddenNote(fieldId: string): HTMLElement | null {
    return within(screen.getByTestId("modal")).queryByTestId(
      `form-template-hidden-note-${fieldId}`,
    );
  }

  test("the editor has a row for every question, each on the form's own setting, named", async () => {
    await renderPage();
    await click(cardButton(FormsCopy.addTemplate));

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(
      within(dialog).getByText(FormsCopy.builderTitle),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(FormsCopy.templateQuestionsDescription),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(FormsCopy.templateAnswersDescription),
    ).toBeInTheDocument();

    expect(
      Array.from(
        within(dialog)
          .getByTestId("form-template-settings")
          .querySelectorAll('[data-testid^="form-template-setting-row-"]'),
      ).map((element: Element): string | null => {
        return element.getAttribute("data-testid");
      }),
    ).toEqual([
      "form-template-setting-row-title",
      "form-template-setting-row-description",
      "form-template-setting-row-severity",
      "form-template-setting-row-office",
    ]);

    expect(shown("title")).toBe(FormsCopy.settingFormDefaultRequired);
    expect(shown("description")).toBe(FormsCopy.settingFormDefaultHidden);
    expect(shown("severity")).toBe(FormsCopy.settingFormDefaultOptional);
    expect(shown("office")).toBe(FormsCopy.settingFormDefaultOptional);

    // Each picker is named by its question.
    expect(
      within(row("severity")).getByRole("combobox", { name: "Severity" }),
    ).toBeInTheDocument();
  });

  test("the answer to a question the template does not ask says it is used as it is - and follows the rows", async () => {
    await renderPage();
    await click(cardButton(FormsCopy.addTemplate));

    // Hidden on the form, and so for the template.
    expect(hiddenNote("description")).toHaveTextContent(
      FormsCopy.templateHiddenAnswerNote,
    );
    expect(hiddenNote("severity")).not.toBeInTheDocument();

    await choose("description", "Optional");

    expect(hiddenNote("description")).not.toBeInTheDocument();

    await choose("severity", "Hidden");

    expect(hiddenNote("severity")).toHaveTextContent(
      FormsCopy.templateHiddenAnswerNote,
    );
  });

  test("the settings chosen are saved with the template; Form default saves none", async () => {
    await renderPage();
    await click(cardButton(FormsCopy.addTemplate));

    fireEvent.change(screen.getByTestId("form-template-name"), {
      target: { value: "Service Restored" },
    });

    await choose("severity", "Required");
    await choose("office", "Hidden");
    await choose("description", "Required");
    // And back: the form's own setting is no setting at all.
    await choose("description", FormsCopy.settingFormDefaultHidden);

    expect(shown("severity")).toBe("Required");
    expect(shown("description")).toBe(FormsCopy.settingFormDefaultHidden);

    await saveDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const saved: FormTemplate = savedTemplates()[2]!;

    expect(saved.name).toBe("Service Restored");
    expect(saved.fieldSettings).toEqual({ severity: Required, office: Hidden });
    // The templates already listed are saved as they were.
    expect(savedTemplates().slice(0, 2)).toEqual([OUTAGE, MAINTENANCE]);
  });

  test("a template whose every question follows the form saves no settings", async () => {
    await renderPage();
    await click(cardButton(FormsCopy.addTemplate));

    fireEvent.change(screen.getByTestId("form-template-name"), {
      target: { value: "Plain" },
    });

    await saveDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedTemplates()[2]).not.toHaveProperty("fieldSettings");
  });

  test("Edit starts from the template's settings; choosing Form default takes one out", async () => {
    storedTemplates = [
      {
        ...OUTAGE,
        fieldSettings: { severity: Required, description: Optional },
      },
      MAINTENANCE,
    ];

    await renderPage();
    await click(screen.getByTestId("form-template-edit-outage"));

    expect(shown("severity")).toBe("Required");
    expect(shown("description")).toBe("Optional");
    expect(shown("title")).toBe(FormsCopy.settingFormDefaultRequired);
    // The description is asked by this template: its answer pre-fills it.
    expect(hiddenNote("description")).not.toBeInTheDocument();

    await choose("severity", FormsCopy.settingFormDefaultOptional);

    await saveDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedTemplates()[0]).toEqual({
      ...OUTAGE,
      fieldSettings: { description: Optional },
    });
  });

  test("the list says what each template changes, in the form's order", async () => {
    storedTemplates = [
      {
        ...OUTAGE,
        fieldSettings: { office: Hidden, description: Required, gone: Hidden },
      },
      MAINTENANCE,
    ];

    await renderPage();

    const chips: Array<Element> = Array.from(
      screen
        .getByTestId("form-template-settings-outage")
        .querySelectorAll("li"),
    );

    expect(
      chips.map((chip: Element): unknown => {
        return [chip.textContent, chip.getAttribute("data-setting")];
      }),
    ).toEqual([
      ["Description · Required", "Required"],
      ["Office · Hidden", "Hidden"],
    ]);

    // A template that asks every question as the form does lists no change.
    expect(
      screen.queryByTestId("form-template-settings-maintenance"),
    ).not.toBeInTheDocument();
  });

  test("Duplicate copies how the template asks each question, without what removed questions left behind", async () => {
    storedTemplates = [
      {
        ...OUTAGE,
        answers: { ...OUTAGE.answers, removed: "x" },
        fieldSettings: { office: Hidden, removed: Required },
      },
      MAINTENANCE,
    ];

    await renderPage();
    await click(screen.getByTestId("form-template-duplicate-outage"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const copy: FormTemplate = savedTemplates()[1]!;

    expect(copy.name).toBe("Application Outage 2");
    expect(copy.fieldSettings).toEqual({ office: Hidden });
    expect(copy.answers).toEqual(OUTAGE.answers);
    // The original is saved as it was: the server does not judge it again.
    expect(savedTemplates()[0]!.fieldSettings).toEqual({
      office: Hidden,
      removed: Required,
    });
  });

  test("a maintenance form's start and end are always asked, and required: their rows cannot change", async () => {
    storedTarget = FormTargetType.ScheduledMaintenance;
    storedFields = [
      {
        id: "title",
        source: FormFieldSource.TargetField,
        targetField: "title",
        label: "Title",
        isRequired: true,
      },
      {
        id: "starts",
        source: FormFieldSource.TargetField,
        targetField: "startsAt",
        label: "Starts At",
        isRequired: true,
      },
      {
        id: "ends",
        source: FormFieldSource.TargetField,
        targetField: "endsAt",
        label: "Ends At",
        isRequired: true,
      },
    ];
    storedTemplates = [];

    await renderPage();
    await click(cardButton(FormsCopy.addTemplate));

    for (const fieldId of ["starts", "ends"]) {
      expect(shown(fieldId)).toBe("Required");
      expect(row(fieldId)).toHaveTextContent(FormsCopy.requiredLocked);
      expect(
        row(fieldId).querySelector(".ou-select--is-disabled"),
      ).not.toBeNull();
    }

    expect(row("title").querySelector(".ou-select--is-disabled")).toBeNull();
  });
});
