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
 * The form builder, drawn for real with its question cards and palette:
 * what it loads, what adding, editing, moving, duplicating and deleting a
 * question does to the draft, Save Changes and Discard Changes, a refused or
 * impossible save, the read-only builder, and the guard against closing the
 * tab with unsaved changes.
 *
 * The network, the permission gate, the preview and the name-and-description
 * dialog are stubbed (each has tests of its own); the builder's state rules
 * are FormBuilderState.test.ts's.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const loadCustomFieldsMock: MockFunction = getJestMockFunction();
const loadRecordOptionsMock: MockFunction = getJestMockFunction();
const recordedPreviews: Array<Record<string, unknown>> = [];
const recordedDetailDialogs: Array<Record<string, unknown>> = [];

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/FormPreviewModal",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        (
          globalThis as unknown as {
            __formBuilderPreviews: Array<Record<string, unknown>>;
          }
        ).__formBuilderPreviews.push(props);
        return React.createElement("div", { "data-testid": "stub-preview" });
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      (
        globalThis as unknown as {
          __formBuilderDetailDialogs: Array<Record<string, unknown>>;
        }
      ).__formBuilderDetailDialogs.push(props);
      return React.createElement("div", { "data-testid": "stub-details" });
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
        return new ObjectIDClass.default("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

(
  globalThis as unknown as {
    __formBuilderPreviews: Array<Record<string, unknown>>;
    __formBuilderDetailDialogs: Array<Record<string, unknown>>;
  }
).__formBuilderPreviews = recordedPreviews;
(
  globalThis as unknown as {
    __formBuilderDetailDialogs: Array<Record<string, unknown>>;
  }
).__formBuilderDetailDialogs = recordedDetailDialogs;

import FormBuilder from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/FormBuilder";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import Form from "../../../Models/DatabaseModels/Form";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import Field from "../../../UI/Components/Forms/Types/Field";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000dd";
const SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000001";
const REGION_ID: string = "b0000000-0000-4000-8000-000000000001";

const OWN_QUESTION: FormField = {
  id: "office",
  source: FormFieldSource.Question,
  type: CustomFieldType.Dropdown,
  label: "Which office?",
  dropdownOptions: "Berlin\nLondon",
  isRequired: false,
};

const SEVERITY_QUESTION: FormField = {
  id: "severity",
  source: FormFieldSource.TargetField,
  targetField: "incidentSeverityId",
  label: "How bad is it?",
  isRequired: false,
};

interface StoredForm {
  name: string;
  description?: string | undefined;
  targetType: FormTargetType;
  fields: Array<FormField>;
  targetSettings?: Record<string, unknown> | undefined;
}

let stored: StoredForm | null | Error;
let gate: PermissionGateResult;

/*
 * A target's starting questions, with ids that stay put from one call to
 * the next (getDefaultFormFields makes new ones every time): the field each
 * one asks.
 */
function startingFields(targetType: FormTargetType): Array<FormField> {
  return getDefaultFormFields(targetType).map((field: FormField): FormField => {
    return {
      ...field,
      id: (field.targetField || field.submitterField || field.id).toLowerCase(),
    };
  });
}

function defaultFields(): Array<FormField> {
  return [
    ...startingFields(FormTargetType.Incident),
    SEVERITY_QUESTION,
    OWN_QUESTION,
  ];
}

beforeEach(() => {
  recordedPreviews.length = 0;
  recordedDetailDialogs.length = 0;

  stored = {
    name: "Report a Problem",
    description: "Tell us what is wrong.",
    targetType: FormTargetType.Incident,
    fields: defaultFields(),
    targetSettings: { incidentSeverityId: SEVERITY_ID },
  };
  gate = { isAllowed: true };

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const form: Form = new Form();
    form._id = FORM_ID;
    form.name = stored.name;
    form.description = stored.description;
    form.targetType = stored.targetType;
    form.fields = JSON.parse(JSON.stringify(stored.fields));
    form.targetSettings = (stored.targetSettings || {}) as never;
    return form;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  loadCustomFieldsMock.mockReset();
  loadCustomFieldsMock.mockImplementation(async (): Promise<unknown> => {
    return [
      {
        id: REGION_ID,
        name: "Region",
        customFieldType: CustomFieldType.Text,
      },
    ];
  });

  loadRecordOptionsMock.mockReset();
  loadRecordOptionsMock.mockImplementation(async (): Promise<unknown> => {
    return [{ id: SEVERITY_ID, name: "Major" }];
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

async function renderBuilder(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <FormBuilder formId={new ObjectID(FORM_ID)} />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("form-canvas")).toBeInTheDocument();
  });
}

// The questions on the canvas, in order, by id.
function questionIds(): Array<string> {
  return Array.from(
    screen
      .getByTestId("form-questions")
      .querySelectorAll('[data-testid^="form-question-"][data-selected]'),
  ).map((element: Element): string => {
    return (element.getAttribute("data-testid") || "").replace(
      "form-question-",
      "",
    );
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

function status(): HTMLElement | null {
  return screen.queryByTestId("form-builder-status");
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("loading", () => {
  test("reads the form's name, description, target, questions and settings", async () => {
    await renderBuilder();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);
    expect(request["select"]).toEqual({
      name: true,
      description: true,
      targetType: true,
      fields: true,
      targetSettings: true,
    });
    expect(loadCustomFieldsMock).toHaveBeenCalledWith(FormTargetType.Incident);
  });

  test("shows the form's header and every question, in order", async () => {
    await renderBuilder();

    expect(screen.getByTestId("form-builder-name")).toHaveTextContent(
      "Report a Problem",
    );
    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "Tell us what is wrong.",
    );
    expect(questionIds()).toEqual(
      defaultFields().map((field: FormField): string => {
        return field.id;
      }),
    );
    // Nothing is changed yet.
    expect(status()).not.toBeInTheDocument();
  });

  test("loads the records a choice offers once, for the questions that need them", async () => {
    await renderBuilder();

    await waitFor(() => {
      expect(loadRecordOptionsMock).toHaveBeenCalledWith(
        FormTargetOptionsSource.IncidentSeverity,
      );
    });
    expect(loadRecordOptionsMock).toHaveBeenCalledTimes(1);
  });

  test("a form with no description says so", async () => {
    (stored as StoredForm).description = undefined;

    await renderBuilder();

    expect(screen.getByText(FormsCopy.noDescription)).toBeInTheDocument();
  });

  test("a form that cannot be read says why", async () => {
    stored = new Error("The form could not be read.");

    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <FormBuilder formId={new ObjectID(FORM_ID)} />
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("The form could not be read.")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("form-canvas")).not.toBeInTheDocument();
  });

  test("a form that is not there says so", async () => {
    stored = null;

    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <FormBuilder formId={new ObjectID(FORM_ID)} />
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText(FormsCopy.shareLinkNotFound)).toBeInTheDocument();
    });
  });
});

describe("the palette", () => {
  test("marks the fields the form already asks as added", async () => {
    await renderBuilder();

    expect(screen.getByTestId("form-palette-target-title")).toBeDisabled();
    expect(screen.getByTestId("form-palette-target-title")).toHaveTextContent(
      FormsCopy.paletteAdded,
    );
    expect(
      screen.getByTestId("form-palette-target-incidentSeverityId"),
    ).toBeDisabled();
    expect(screen.getByTestId("form-palette-target-monitors")).toBeEnabled();
    expect(
      screen.getByTestId(`form-palette-custom-field-${REGION_ID}`),
    ).toBeEnabled();
  });

  test("adds a question at the end, opened for editing, as a draft", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-palette-question-Text"));

    const ids: Array<string> = questionIds();
    const added: string = ids[ids.length - 1]!;

    expect(ids).toHaveLength(defaultFields().length + 1);
    expect(screen.getByTestId(`form-question-${added}`)).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(
      screen.getByTestId(`form-question-label-${added}`),
    ).toHaveValue(FormsCopy.newQuestionLabel);
    expect(status()).toHaveTextContent(FormsCopy.unsavedChanges);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("adds right after the question that is selected", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-severity"));
    await click(screen.getByTestId(`form-palette-custom-field-${REGION_ID}`));

    const ids: Array<string> = questionIds();

    expect(ids[ids.indexOf("severity") + 1]).not.toBe("office");
    expect(
      screen.getByTestId(`form-question-badge-${ids[ids.indexOf("severity") + 1]!}`),
    ).toHaveTextContent("Region");
    // And now Region shows as added.
    expect(
      screen.getByTestId(`form-palette-custom-field-${REGION_ID}`),
    ).toBeDisabled();
  });
});

describe("editing a question", () => {
  test("the card shows the change at once, and Save Changes writes every question", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-office"));
    fireEvent.change(screen.getByTestId("form-question-label-office"), {
      target: { value: "Which office are you in?" },
    });

    expect(
      within(screen.getByTestId("form-question-office")).getByTestId(
        "form-question-select-office",
      ),
    ).toHaveTextContent("Which office are you in?");

    await click(cardButton(FormsCopy.saveChanges));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;
    const fields: Array<FormField> = (
      request["data"] as Record<string, unknown>
    )["fields"] as Array<FormField>;

    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);
    expect(
      fields.map((field: FormField): string => {
        return field.label;
      }),
    ).toEqual([
      "Title",
      "Description",
      "Your Name",
      "Your Email",
      "How bad is it?",
      "Which office are you in?",
    ]);

    await waitFor(() => {
      expect(status()).toHaveTextContent(FormsCopy.savedChanges);
    });
  });

  test("a question too long is cut to the longest a label may be", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-office"));
    fireEvent.change(screen.getByTestId("form-question-label-office"), {
      target: { value: "x".repeat(250) },
    });

    expect(
      (screen.getByTestId("form-question-label-office") as HTMLInputElement)
        .value.length,
    ).toBe(200);
  });

  test("Required is a switch on the card, and the asterisk follows it", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-office"));

    const required: HTMLElement = within(
      screen.getByTestId("form-question-editor-office"),
    ).getByRole("switch");

    expect(required).toHaveAttribute("aria-checked", "false");

    await click(required);

    expect(required).toHaveAttribute("aria-checked", "true");
    expect(
      within(screen.getByTestId("form-question-select-office")).getByText("*"),
    ).toBeInTheDocument();
  });

  test("Move Down and Move Up reorder the draft", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-move-down-title"));
    expect(questionIds().slice(0, 2)).toEqual([
      defaultFields()[1]!.id,
      defaultFields()[0]!.id,
    ]);

    await click(screen.getByTestId("form-question-move-up-title"));
    expect(questionIds()[0]).toBe(defaultFields()[0]!.id);

    // The first cannot go up, nor the last down.
    expect(
      screen.getByTestId(`form-question-move-up-${defaultFields()[0]!.id}`),
    ).toBeDisabled();
    expect(screen.getByTestId("form-question-move-down-office")).toBeDisabled();
  });

  test("Duplicate copies a question of the form's own, right below it", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-office"));
    await click(screen.getByTestId("form-question-duplicate-office"));

    const ids: Array<string> = questionIds();
    const copy: string = ids[ids.indexOf("office") + 1]!;

    expect(copy).toBeDefined();
    expect(copy).not.toBe("office");
    expect(
      screen.getByTestId(`form-question-select-${copy}`),
    ).toHaveTextContent("Which office?");
  });

  test("only a question of the form's own can be duplicated", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-severity"));

    expect(
      screen.queryByTestId("form-question-duplicate-severity"),
    ).not.toBeInTheDocument();
  });

  test("Delete Question takes it off the draft", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-office"));
    await click(screen.getByTestId("form-question-delete-office"));

    expect(questionIds()).not.toContain("office");
    expect(status()).toHaveTextContent(FormsCopy.unsavedChanges);
  });

  test("Done closes the card", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-office"));
    await click(screen.getByTestId("form-question-done-office"));

    expect(
      screen.queryByTestId("form-question-editor-office"),
    ).not.toBeInTheDocument();
  });

  test("Discard Changes puts the saved questions back", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-office"));
    await click(screen.getByTestId("form-question-delete-office"));
    await click(screen.getByTestId("form-builder-discard"));

    expect(questionIds()).toEqual(
      defaultFields().map((field: FormField): string => {
        return field.id;
      }),
    );
    expect(status()).not.toBeInTheDocument();
  });
});

describe("a maintenance form's start and end", () => {
  test("cannot be deleted, and stay required", async () => {
    stored = {
      name: "Request Maintenance",
      targetType: FormTargetType.ScheduledMaintenance,
      fields: startingFields(FormTargetType.ScheduledMaintenance),
    };

    await renderBuilder();

    const startsAt: FormField = startingFields(
      FormTargetType.ScheduledMaintenance,
    ).find((field: FormField): boolean => {
      return field.targetField === "startsAt";
    })!;

    await click(screen.getByTestId(`form-question-select-${startsAt.id}`));

    expect(
      screen.getByTestId(`form-question-delete-${startsAt.id}`),
    ).toBeDisabled();
    expect(
      within(screen.getByTestId(`form-question-editor-${startsAt.id}`)).getByRole(
        "switch",
      ),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(FormsCopy.requiredLocked),
    ).toBeInTheDocument();
  });
});

describe("saving", () => {
  test("a question that breaks a rule is not sent: the builder says what is wrong", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-question-select-office"));
    fireEvent.change(screen.getByTestId("form-question-label-office"), {
      target: { value: "   " },
    });

    await click(cardButton(FormsCopy.saveChanges));

    expect(screen.getByTestId("form-builder-save-error")).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a save the server refuses keeps the draft, and says why", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Questions: two questions ask for the same field.");
    });

    await renderBuilder();

    await click(screen.getByTestId("form-palette-question-Text"));
    await click(cardButton(FormsCopy.saveChanges));

    await waitFor(() => {
      expect(screen.getByTestId("form-builder-save-error")).toHaveTextContent(
        "Questions: two questions ask for the same field.",
      );
    });
    expect(status()).toHaveTextContent(FormsCopy.unsavedChanges);
    expect(questionIds()).toHaveLength(defaultFields().length + 1);
  });

  test("Save Changes is only pressable with something to save", async () => {
    await renderBuilder();

    expect(cardButton(FormsCopy.saveChanges)).toBeDisabled();

    await click(screen.getByTestId("form-palette-question-Text"));

    expect(cardButton(FormsCopy.saveChanges)).toBeEnabled();
  });
});

describe("leaving with unsaved changes", () => {
  function leave(): boolean {
    const event: Event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  test("asks first while there are unsaved changes, and not otherwise", async () => {
    await renderBuilder();

    expect(leave()).toBe(false);

    await click(screen.getByTestId("form-palette-question-Text"));

    expect(leave()).toBe(true);

    await click(screen.getByTestId("form-builder-discard"));

    expect(leave()).toBe(false);
  });
});

describe("Preview and the name and description", () => {
  test("Preview draws the questions being built, saved or not", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-palette-question-Text"));
    await click(cardButton(FormsCopy.preview));

    expect(screen.getByTestId("stub-preview")).toBeInTheDocument();

    const preview: Record<string, unknown> =
      recordedPreviews[recordedPreviews.length - 1]!;

    expect(preview["name"]).toBe("Report a Problem");
    expect(preview["description"]).toBe("Tell us what is wrong.");
    expect((preview["fields"] as Array<FormField>).length).toBe(
      defaultFields().length + 1,
    );
    expect(preview["targetType"]).toBe(FormTargetType.Incident);
    // The form's own severity starts chosen, as on the public page.
    expect(preview["defaultOptionValues"]).toEqual({
      incidentSeverityId: SEVERITY_ID,
    });
  });

  test("Edit Name and Description edits only those, and keeps the draft of the questions", async () => {
    await renderBuilder();

    await click(screen.getByTestId("form-palette-question-Text"));
    await click(screen.getByTestId("form-builder-edit-details"));

    const dialog: Record<string, unknown> =
      recordedDetailDialogs[recordedDetailDialogs.length - 1]!;
    const formProps: Record<string, unknown> = dialog["formProps"] as Record<
      string,
      unknown
    >;
    const fields: Array<Field<Form>> = formProps["fields"] as Array<
      Field<Form>
    >;

    expect(dialog["modelType"]).toBe(Form);
    expect((dialog["modelIdToEdit"] as ObjectID).toString()).toBe(FORM_ID);
    expect(
      fields.map((field: Field<Form>): string => {
        return Object.keys(field.field || {})[0] || "";
      }),
    ).toEqual(["name", "description"]);
    // Shown on the public page, where a private image cannot load.
    expect(fields[1]!.allowImageUpload).toBe(false);

    // Saved: the header reads the new name, and the draft is still there.
    (stored as StoredForm).name = "Report an Outage";

    await act(async () => {
      (dialog["onSuccess"] as () => void)();
    });

    await waitFor(() => {
      expect(screen.getByTestId("form-builder-name")).toHaveTextContent(
        "Report an Outage",
      );
    });
    expect(questionIds()).toHaveLength(defaultFields().length + 1);
    expect(status()).toHaveTextContent(FormsCopy.unsavedChanges);
  });
});

describe("someone who may not edit the form", () => {
  test("sees the questions, why they cannot change them, and nothing to change them with", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Form permission.",
    };

    await renderBuilder();

    expect(screen.getByTestId("form-builder-read-only")).toHaveTextContent(
      "You need the Edit Form permission.",
    );
    expect(screen.queryByTestId("form-builder-palette")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("form-builder-edit-details"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("form-question-select-office")).toBeDisabled();
    expect(
      screen.queryByTestId("form-question-move-up-office"),
    ).not.toBeInTheDocument();
    expect(
      screen
        .queryAllByTestId("card-button")
        .some((button: HTMLElement): boolean => {
          return (button.textContent || "").includes(FormsCopy.saveChanges);
        }),
    ).toBe(false);
    // Preview is still there: reading is allowed.
    expect(cardButton(FormsCopy.preview)).toBeInTheDocument();
  });

  test("the gate is asked about updating a form", async () => {
    const check: MockFunction = PermissionGate.check as unknown as MockFunction;

    await renderBuilder();

    const [model, action] = check.mock.calls[0] as [unknown, ModelAction];

    expect(model).toBeInstanceOf(Form);
    expect(action).toBe(ModelAction.Update);
  });
});
