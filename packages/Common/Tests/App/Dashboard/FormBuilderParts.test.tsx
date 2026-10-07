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

/*
 * The form builder's parts, each on its own: the palette (what it offers,
 * what it marks added, what it hands the builder), a question card (its
 * badge, its warnings, its controls, read-only) and the preview (the public
 * form drawn from the draft, whose submit sends nothing).
 */

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

import FormPreviewModal from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/FormPreviewModal";
import { FormBrandingValues } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Branding/FormBrandingValues";
import File from "../../../Models/DatabaseModels/File";
import MimeType from "../../../Types/File/MimeType";
import QuestionCard from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/QuestionCard";
import QuestionPalette, {
  PaletteItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/QuestionPalette";
import { getFormPaletteState } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderState";
import FormsCopy, {
  FORM_QUESTION_TYPE_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FORM_MAX_FIELDS,
  FORM_QUESTION_TYPES,
  FormField,
  FormFieldSource,
  FormSubmitterField,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import { FormCustomFieldDefinition } from "../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";

const REGION_ID: string = "b0000000-0000-4000-8000-000000000001";
const SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000001";

const REGION: FormCustomFieldDefinition = {
  id: REGION_ID,
  name: "Region",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "EU\nUS",
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the palette", () => {
  let onAdd: MockFunction;

  beforeEach(() => {
    onAdd = getJestMockFunction();
  });

  function renderPalette(data: {
    targetType?: FormTargetType;
    fields?: Array<FormField>;
    customFields?: Array<FormCustomFieldDefinition>;
  }): void {
    const targetType: FormTargetType =
      data.targetType || FormTargetType.Incident;

    render(
      <MemoryRouter>
        <QuestionPalette
          targetType={targetType}
          palette={getFormPaletteState({
            fields: data.fields || [],
            targetType,
            customFields: data.customFields || [],
          })}
          onAdd={(item: PaletteItem) => {
            onAdd(item);
          }}
        />
      </MemoryRouter>,
    );
  }

  test("offers every answer type, named and described as the palette words them", () => {
    renderPalette({});

    for (const type of FORM_QUESTION_TYPES) {
      const entry: HTMLElement = screen.getByTestId(
        `form-palette-question-${type}`,
      );

      expect(entry).toHaveTextContent(FORM_QUESTION_TYPE_TEXT[type].title);
      expect(entry).toHaveTextContent(
        FORM_QUESTION_TYPE_TEXT[type].description,
      );
    }
  });

  test("a question of the form's own is handed over by type, as an untitled question", () => {
    renderPalette({});

    fireEvent.click(screen.getByTestId("form-palette-question-Dropdown"));

    expect(onAdd).toHaveBeenCalledWith({
      kind: "question",
      type: CustomFieldType.Dropdown,
      label: FormsCopy.newQuestionLabel,
    });
  });

  test("the incident's fields, the ones asked marked added and not offered again", () => {
    renderPalette({ fields: getDefaultFormFields(FormTargetType.Incident) });

    expect(screen.getByTestId("form-palette-target-fields")).toHaveTextContent(
      FormsCopy.paletteIncidentFields,
    );
    expect(screen.getByTestId("form-palette-target-title")).toBeDisabled();
    expect(screen.getByTestId("form-palette-target-title")).toHaveTextContent(
      FormsCopy.paletteAdded,
    );

    fireEvent.click(screen.getByTestId("form-palette-target-labels"));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "target",
        definition: expect.objectContaining({ key: "labels" }),
      }),
    );
  });

  test("a maintenance form's fields are its own", () => {
    renderPalette({ targetType: FormTargetType.ScheduledMaintenance });

    expect(screen.getByTestId("form-palette-target-fields")).toHaveTextContent(
      FormsCopy.paletteScheduledMaintenanceFields,
    );
    expect(
      screen.getByTestId("form-palette-target-startsAt"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("form-palette-target-incidentSeverityId"),
    ).not.toBeInTheDocument();
  });

  test("custom fields by name, with their type", () => {
    renderPalette({ customFields: [REGION] });

    const entry: HTMLElement = screen.getByTestId(
      `form-palette-custom-field-${REGION_ID}`,
    );

    expect(entry).toHaveTextContent("Region");
    expect(entry).toHaveTextContent(
      FORM_QUESTION_TYPE_TEXT[CustomFieldType.Dropdown].title,
    );

    fireEvent.click(entry);

    expect(onAdd).toHaveBeenCalledWith({
      kind: "customField",
      definition: REGION,
    });
  });

  test.each([
    [
      FormTargetType.Incident,
      FormsCopy.noCustomFieldsIncident,
      "/incidents/settings/custom-fields",
    ],
    [
      FormTargetType.ScheduledMaintenance,
      FormsCopy.noCustomFieldsScheduledMaintenance,
      "/scheduled-maintenance-events/settings/custom-fields",
    ],
  ])(
    "a %s form in a project without custom fields says where to make them",
    (targetType: FormTargetType, note: string, path: string) => {
      renderPalette({ targetType });

      expect(screen.getByText(note)).toBeInTheDocument();
      expect(
        screen.getByText(FormsCopy.manageCustomFields).closest("a"),
      ).toHaveAttribute("href", expect.stringContaining(path));
    },
  );

  test("the submitter's name and email", () => {
    renderPalette({});

    fireEvent.click(screen.getByTestId("form-palette-submitter-Email"));

    expect(onAdd).toHaveBeenCalledWith({
      kind: "submitter",
      submitterField: FormSubmitterField.Email,
    });
  });

  test("a full form offers nothing more, and says so", () => {
    const fields: Array<FormField> = Array.from(
      { length: FORM_MAX_FIELDS },
      (_entry: unknown, index: number): FormField => {
        return {
          id: `q${index}`,
          source: FormFieldSource.Question,
          type: CustomFieldType.Text,
          label: `Question ${index}`,
          isRequired: false,
        };
      },
    );

    renderPalette({ fields, customFields: [REGION] });

    expect(screen.getByText(FormsCopy.paletteFull)).toBeInTheDocument();

    for (const button of within(
      screen.getByTestId("form-question-palette"),
    ).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});

describe("a question card", () => {
  interface Handlers {
    onSelect: MockFunction;
    onDeselect: MockFunction;
    onChange: MockFunction;
    onMove: MockFunction;
    onDuplicate: MockFunction;
    onDelete: MockFunction;
  }

  let handlers: Handlers;

  beforeEach(() => {
    handlers = {
      onSelect: getJestMockFunction(),
      onDeselect: getJestMockFunction(),
      onChange: getJestMockFunction(),
      onMove: getJestMockFunction(),
      onDuplicate: getJestMockFunction(),
      onDelete: getJestMockFunction(),
    };
  });

  function renderCard(data: {
    field: FormField;
    isSelected?: boolean;
    isReadOnly?: boolean;
    index?: number;
    count?: number;
    customFields?: Array<FormCustomFieldDefinition>;
    targetType?: FormTargetType;
  }): void {
    render(
      <QuestionCard
        field={data.field}
        index={data.index ?? 1}
        count={data.count ?? 3}
        targetType={data.targetType || FormTargetType.Incident}
        customFields={data.customFields || [REGION]}
        recordOptions={{
          [FormTargetOptionsSource.IncidentSeverity]: [
            { id: SEVERITY_ID, name: "Major" },
          ],
        }}
        isSelected={Boolean(data.isSelected)}
        isReadOnly={Boolean(data.isReadOnly)}
        onSelect={() => {
          handlers.onSelect();
        }}
        onDeselect={() => {
          handlers.onDeselect();
        }}
        onChange={(changes: Partial<FormField>) => {
          handlers.onChange(changes);
        }}
        onMove={(offset: number) => {
          handlers.onMove(offset);
        }}
        onDuplicate={() => {
          handlers.onDuplicate();
        }}
        onDelete={() => {
          handlers.onDelete();
        }}
      />,
    );
  }

  test.each([
    [
      {
        id: "q",
        source: FormFieldSource.TargetField,
        targetField: "incidentSeverityId",
        label: "How bad?",
        isRequired: false,
      } as FormField,
      "Incident · Severity",
    ],
    [
      {
        id: "q",
        source: FormFieldSource.TargetCustomField,
        customFieldId: REGION_ID,
        label: "Where?",
        isRequired: false,
      } as FormField,
      "Custom Field · Region",
    ],
    [
      {
        id: "q",
        source: FormFieldSource.Submitter,
        submitterField: FormSubmitterField.Email,
        label: "Your Email",
        isRequired: true,
      } as FormField,
      "Submitter · Email",
    ],
    [
      {
        id: "q",
        source: FormFieldSource.Question,
        type: CustomFieldType.LongText,
        label: "Anything else?",
        isRequired: false,
      } as FormField,
      FORM_QUESTION_TYPE_TEXT[CustomFieldType.LongText].title,
    ],
  ])("says what it is linked to: %#", (field: FormField, badge: string) => {
    renderCard({ field });

    expect(screen.getByTestId("form-question-badge-q")).toHaveTextContent(
      badge,
    );
  });

  test("reads like the public form: the question, the asterisk, the help text and the choices", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.Question,
        type: CustomFieldType.Dropdown,
        label: "Which office?",
        helpText: "Where you sit.",
        dropdownOptions: "Berlin\nLondon",
        isRequired: true,
      },
    });

    const select: HTMLElement = screen.getByTestId("form-question-select-q");

    expect(select).toHaveTextContent("Which office?");
    expect(select).toHaveTextContent("*");
    expect(select).toHaveTextContent("Where you sit.");
    expect(screen.getByTestId("form-question-q")).toHaveTextContent("Berlin");
    expect(screen.getByTestId("form-question-q")).toHaveTextContent("London");
    expect(
      screen.queryByTestId("form-question-editor-q"),
    ).not.toBeInTheDocument();
  });

  test("an untitled question says so", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.Question,
        type: CustomFieldType.Text,
        label: "",
        isRequired: false,
      },
    });

    expect(screen.getByTestId("form-question-select-q")).toHaveTextContent(
      FormsCopy.newQuestionLabel,
    );
    expect(screen.getByTestId("form-question-issues")).toHaveTextContent(
      FormsCopy.issueNoLabel,
    );
  });

  test("a deleted custom field's question says it is not asked", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.TargetCustomField,
        customFieldId: "c0000000-0000-4000-8000-0000000000ee",
        label: "Gone",
        isRequired: false,
      },
    });

    expect(screen.getByTestId("form-question-issues")).toHaveTextContent(
      FormsCopy.issueCustomFieldDeleted,
    );
    expect(screen.getByTestId("form-question-badge-q")).toHaveTextContent(
      FormsCopy.deletedRecord,
    );
  });

  test("a field that copies a monitor's value says the monitors' value replaces the answer", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.TargetCustomField,
        customFieldId: "c0000000-0000-4000-8000-0000000000aa",
        label: "Vendor",
        isRequired: false,
      },
      customFields: [
        {
          id: "c0000000-0000-4000-8000-0000000000aa",
          name: "Vendor",
          customFieldType: CustomFieldType.Text,
          isCopiedFromMonitor: true,
        },
      ],
    });

    expect(
      screen.getByTestId("form-question-copied-from-monitor-q"),
    ).toHaveTextContent(FormsCopy.copiedFromMonitor);
  });

  test("an ordinary custom field says nothing of monitors", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.TargetCustomField,
        customFieldId: REGION_ID,
        label: "Where?",
        isRequired: false,
      },
    });

    expect(
      screen.queryByTestId("form-question-copied-from-monitor-q"),
    ).not.toBeInTheDocument();
  });

  test("a monitor question with nothing offered says it is not asked", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.TargetField,
        targetField: "monitors",
        label: "Which service?",
        isRequired: false,
      },
    });

    expect(screen.getByTestId("form-question-issues")).toHaveTextContent(
      FormsCopy.issueNoAllowedOptions,
    );
  });

  test("selecting and leaving it", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.Question,
        type: CustomFieldType.Text,
        label: "Ticket",
        isRequired: false,
      },
    });

    fireEvent.click(screen.getByTestId("form-question-select-q"));
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  test("selected, its settings open beneath it and hand every change over", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.Question,
        type: CustomFieldType.Text,
        label: "Ticket",
        isRequired: false,
      },
      isSelected: true,
    });

    expect(screen.getByTestId("form-question-select-q")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.change(screen.getByTestId("form-question-label-q"), {
      target: { value: "Ticket number" },
    });
    expect(handlers.onChange).toHaveBeenLastCalledWith({
      label: "Ticket number",
    });

    fireEvent.change(screen.getByTestId("form-question-help-q"), {
      target: { value: "From the support tool." },
    });
    expect(handlers.onChange).toHaveBeenLastCalledWith({
      helpText: "From the support tool.",
    });

    fireEvent.click(screen.getByTestId("form-question-required-q"));
    expect(handlers.onChange).toHaveBeenLastCalledWith({ isRequired: true });

    fireEvent.click(screen.getByTestId("form-question-duplicate-q"));
    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("form-question-delete-q"));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("form-question-done-q"));
    expect(handlers.onDeselect).toHaveBeenCalledTimes(1);

    // Clicking the open card's question closes it too.
    fireEvent.click(screen.getByTestId("form-question-select-q"));
    expect(handlers.onDeselect).toHaveBeenCalledTimes(2);
  });

  test("a linked field says where its answer goes, and has no answer type to change", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.TargetField,
        targetField: "title",
        label: "What is wrong?",
        isRequired: true,
      },
      isSelected: true,
    });

    expect(screen.getByTestId("form-question-link-note")).toHaveTextContent(
      FormsCopy.linkedTargetFieldNote,
    );
    expect(
      screen.queryByTestId("form-question-type-q"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("form-question-duplicate-q"),
    ).not.toBeInTheDocument();
  });

  test("a severity question offers the project's severities to narrow it to", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.TargetField,
        targetField: "incidentSeverityId",
        label: "How bad?",
        isRequired: false,
      },
      isSelected: true,
    });

    expect(screen.getByText(FormsCopy.choicesOffered)).toBeInTheDocument();
    expect(
      screen.getByText(FormsCopy.choicesOfferedSeverity),
    ).toBeInTheDocument();
    // Severities are offered all together unless narrowed: the card lists them.
    expect(screen.getByTestId("form-question-q")).toHaveTextContent("Major");
  });

  test("Move Up and Move Down, each where it can move", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.Question,
        type: CustomFieldType.Text,
        label: "Ticket",
        isRequired: false,
      },
      index: 0,
      count: 2,
    });

    expect(screen.getByTestId("form-question-move-up-q")).toBeDisabled();
    fireEvent.click(screen.getByTestId("form-question-move-down-q"));
    expect(handlers.onMove).toHaveBeenCalledWith(1);
    expect(screen.getByTestId("form-question-move-up-q")).toHaveAttribute(
      "aria-label",
      `${FormsCopy.moveUp}: Ticket`,
    );
  });

  test("read-only, it can be read and nothing else", () => {
    renderCard({
      field: {
        id: "q",
        source: FormFieldSource.Question,
        type: CustomFieldType.Text,
        label: "Ticket",
        isRequired: false,
      },
      isReadOnly: true,
    });

    expect(screen.getByTestId("form-question-select-q")).toBeDisabled();
    expect(
      screen.queryByTestId("form-question-drag-q"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("form-question-move-up-q"),
    ).not.toBeInTheDocument();
  });
});

describe("a question card: Hidden", () => {
  let onChange: MockFunction;

  beforeEach(() => {
    onChange = getJestMockFunction();
  });

  function renderHiddenCard(
    field: FormField,
    targetType?: FormTargetType,
  ): void {
    render(
      <QuestionCard
        field={field}
        index={1}
        count={3}
        targetType={targetType || FormTargetType.Incident}
        customFields={[REGION]}
        recordOptions={{}}
        isSelected={true}
        isReadOnly={false}
        onSelect={() => {}}
        onDeselect={() => {}}
        onChange={(changes: Partial<FormField>) => {
          onChange(changes);
        }}
        onMove={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
      />,
    );
  }

  const DESCRIPTION: FormField = {
    id: "description",
    source: FormFieldSource.TargetField,
    targetField: "description",
    label: "Description",
    isRequired: false,
  };

  test("a shown question offers Hidden, off, and says what it does", () => {
    renderHiddenCard(DESCRIPTION);

    const hidden: HTMLElement = screen.getByTestId(
      "form-question-hidden-description",
    );

    expect(hidden).toHaveAttribute("aria-checked", "false");
    expect(hidden).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText(FormsCopy.hiddenDescription)).toBeInTheDocument();
    expect(
      screen.queryByTestId("form-question-hidden-badge-description"),
    ).not.toBeInTheDocument();
  });

  test("turning it on hands the change over", () => {
    renderHiddenCard(DESCRIPTION);

    fireEvent.click(screen.getByTestId("form-question-hidden-description"));

    expect(onChange).toHaveBeenLastCalledWith({ isHidden: true });
  });

  test("a hidden question says so on its card, and is not required - nor can it be made so", () => {
    renderHiddenCard({ ...DESCRIPTION, isHidden: true });

    expect(
      screen.getByTestId("form-question-hidden-badge-description"),
    ).toHaveTextContent("Hidden");
    expect(
      screen.getByTestId("form-question-hidden-description"),
    ).toHaveAttribute("aria-checked", "true");

    const required: HTMLElement = screen.getByTestId(
      "form-question-required-description",
    );

    expect(required).toHaveAttribute("aria-checked", "false");
    expect(required).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(FormsCopy.requiredHidden)).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId("form-question-select-description"),
      ).queryByText("*"),
    ).not.toBeInTheDocument();
  });

  test("turning it off hands that over too", () => {
    renderHiddenCard({ ...DESCRIPTION, isHidden: true });

    fireEvent.click(screen.getByTestId("form-question-hidden-description"));

    expect(onChange).toHaveBeenLastCalledWith({ isHidden: false });
  });

  test("a field the target cannot be created without cannot be hidden", () => {
    renderHiddenCard(
      {
        id: "starts",
        source: FormFieldSource.TargetField,
        targetField: "startsAt",
        label: "Starts At",
        isRequired: true,
      },
      FormTargetType.ScheduledMaintenance,
    );

    const hidden: HTMLElement = screen.getByTestId(
      "form-question-hidden-starts",
    );

    expect(hidden).toHaveAttribute("aria-checked", "false");
    expect(hidden).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(hidden);

    expect(onChange).not.toHaveBeenCalledWith({ isHidden: true });
  });

  test("an unselected hidden question still shows its badge", () => {
    render(
      <QuestionCard
        field={{ ...DESCRIPTION, isHidden: true }}
        index={1}
        count={3}
        targetType={FormTargetType.Incident}
        customFields={[REGION]}
        recordOptions={{}}
        isSelected={false}
        isReadOnly={true}
        onSelect={() => {}}
        onDeselect={() => {}}
        onChange={() => {}}
        onMove={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(
      screen.getByTestId("form-question-hidden-badge-description"),
    ).toBeInTheDocument();
  });
});

describe("the preview", () => {
  let onClose: MockFunction;

  beforeEach(() => {
    onClose = getJestMockFunction();
  });

  async function renderPreview(
    fields: Array<FormField>,
    branding?: FormBrandingValues,
    templates?: unknown,
  ): Promise<void> {
    await act(async () => {
      render(
        <FormPreviewModal
          name="Report a Problem"
          description="Tell us what is wrong."
          fields={fields}
          targetType={FormTargetType.Incident}
          customFields={[REGION]}
          recordOptions={{
            [FormTargetOptionsSource.IncidentSeverity]: [
              { id: SEVERITY_ID, name: "Major" },
            ],
          }}
          defaultOptionValues={{ incidentSeverityId: SEVERITY_ID }}
          branding={branding}
          templates={templates}
          onClose={() => {
            onClose();
          }}
        />,
      );
    });
  }

  const TITLE: FormField = {
    id: "what",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "What is wrong?",
    isRequired: true,
  };

  test("draws the form's name, description and questions", async () => {
    await renderPreview([
      TITLE,
      {
        id: "region",
        source: FormFieldSource.TargetCustomField,
        customFieldId: REGION_ID,
        label: "Where?",
        isRequired: false,
      },
    ]);

    const preview: HTMLElement = screen.getByTestId("form-preview");

    expect(preview).toHaveTextContent("Report a Problem");
    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "Tell us what is wrong.",
    );
    expect(screen.getByTestId("form-preview-field-what")).toBeInTheDocument();
    expect(preview).toHaveTextContent("Where?");
    expect(
      screen.queryByTestId("form-preview-skipped"),
    ).not.toBeInTheDocument();
  });

  test("says when it leaves a flagged question out", async () => {
    await renderPreview([
      TITLE,
      {
        id: "gone",
        source: FormFieldSource.TargetCustomField,
        customFieldId: "c0000000-0000-4000-8000-0000000000ee",
        label: "Gone",
        isRequired: false,
      },
    ]);

    expect(screen.getByTestId("form-preview-skipped")).toHaveTextContent(
      FormsCopy.previewSkipped,
    );
    expect(screen.getByTestId("form-preview")).not.toHaveTextContent("Gone");
  });

  test("checks answers as the public page does, then says nothing was submitted", async () => {
    await renderPreview([TITLE]);

    await act(async () => {
      fireEvent.click(
        document.getElementById("form-preview-form-submit-button")!,
      );
    });

    expect(
      await screen.findByText("What is wrong? is required."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("form-preview-submitted"),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("form-preview-field-what"), {
      target: { value: "Checkout is down" },
    });

    await act(async () => {
      fireEvent.click(
        document.getElementById("form-preview-form-submit-button")!,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("form-preview-submitted")).toHaveTextContent(
        FormsCopy.previewSubmitted,
      );
    });

    // Fill It In Again: a fresh, empty form.
    await act(async () => {
      fireEvent.click(screen.getByTestId("form-preview-again"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("form-preview-field-what")).toHaveValue("");
    });
  });

  test("draws the OneUptime logo over the form's name, as the page does without one", async () => {
    await renderPreview([TITLE]);

    const logo: HTMLElement = within(
      screen.getByTestId("form-preview"),
    ).getByTestId("form-logo");

    expect(logo).toHaveAttribute("data-logo", "oneuptime");
    expect(logo).toHaveAttribute("alt", "OneUptime");
  });

  test("draws the form's own logo, with its alt text, as the page does", async () => {
    const logo: File = new File();
    logo.fileType = MimeType.png;
    logo.file = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    await renderPreview([TITLE], { logoFile: logo, logoAltText: "Acme Inc." });

    const drawn: HTMLElement = within(
      screen.getByTestId("form-preview"),
    ).getByTestId("form-logo");

    expect(drawn).toHaveAttribute("data-logo", "form");
    expect(drawn).toHaveAttribute(
      "src",
      `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`,
    );
    expect(drawn).toHaveAttribute("alt", "Acme Inc.");
  });

  test("Close closes it", async () => {
    await renderPreview([TITLE]);

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("modal")).getByTestId(
          "modal-footer-close-button",
        ),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
  describe("templates and hidden questions", () => {
    const DETAILS: FormField = {
      id: "details",
      source: FormFieldSource.TargetField,
      targetField: "description",
      label: "Details",
      isRequired: false,
      isHidden: true,
    };

    const TEMPLATES: Array<Record<string, unknown>> = [
      {
        id: "outage",
        name: "Application Outage",
        answers: { what: "The application is down", details: "Hidden text" },
      },
      {
        id: "restored",
        name: "Service Restored",
        isDefault: true,
        answers: { what: "Service restored" },
      },
    ];

    function titleValue(): string {
      return (screen.getByTestId("form-preview-field-what") as HTMLInputElement)
        .value;
    }

    test("a hidden question is not drawn, as the page does not draw it", async () => {
      await renderPreview([TITLE, DETAILS]);

      expect(screen.getByTestId("form-preview")).not.toHaveTextContent(
        "Details",
      );
    });

    test("a form without templates has no picker", async () => {
      await renderPreview([TITLE]);

      expect(
        screen.queryByTestId("form-preview-template-picker"),
      ).not.toBeInTheDocument();
    });

    test("lists the templates in the page's words, and opens on the default", async () => {
      await renderPreview([TITLE, DETAILS], undefined, TEMPLATES);

      const picker: HTMLElement = screen.getByTestId(
        "form-preview-template-picker",
      );

      expect(picker).toHaveTextContent(FormsCopy.templatePickerLabel);
      expect(picker).toHaveTextContent(FormsCopy.templatePickerDescription);
      expect(picker).toHaveTextContent("Service Restored");
      expect(titleValue()).toBe("Service restored");
      // A template's answer to a hidden question is never drawn.
      expect(screen.getByTestId("form-preview")).not.toHaveTextContent(
        "Hidden text",
      );
    });

    test("without a default it opens on no template", async () => {
      await renderPreview([TITLE], undefined, [TEMPLATES[0]]);

      expect(
        screen.getByTestId("form-preview-template-picker"),
      ).toHaveTextContent(FormsCopy.noTemplate);
      expect(titleValue()).toBe("");
    });
  });
});
