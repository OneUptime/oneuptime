import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BasicFormModal from "../../../../UI/Components/FormModal/BasicFormModal";
import { FormType } from "../../../../UI/Components/Forms/ModelForm";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  MARKDOWN_FORM_MODAL_WIDTH,
  getFormModalWidth,
  hasMarkdownField,
} from "../../../../UI/Components/Forms/Utils/FormModalWidth";
import { ModalWidth } from "../../../../UI/Components/Modal/Modal";
import ModelFormModal from "../../../../UI/Components/ModelFormModal/ModelFormModal";
import IncidentNoteTemplate from "../../../../Models/DatabaseModels/IncidentNoteTemplate";
import getJestMockFunction from "../../../MockType";

/*
 * "Can you please make these forms wide where markdown editor is shown?" -
 * the maintainer, on the Create New Incident Note Template dialog, whose
 * Markdown editor's toolbar wrapped onto two lines.
 *
 * A form with a Markdown field opens in the wide (Large) dialog, whether it
 * has steps or not and whatever width its page asked for; every other form
 * keeps the width it had. ModelFormModal and BasicFormModal - the dialogs of
 * every table's Create and Edit, every card's Edit and the other forms -
 * both apply it.
 */

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
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

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

jest.mock("../../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return new ObjectID("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

const WIDTH_CLASS: Record<string, string> = {
  [ModalWidth.Normal]: "sm:max-w-lg",
  [ModalWidth.Medium]: "sm:max-w-3xl",
  [ModalWidth.Large]: "sm:max-w-7xl",
};

const textField: Field<JSONObject> = {
  field: { title: true },
  title: "Title",
  fieldType: FormFieldSchemaType.Text,
  stepId: "info",
};

const longTextField: Field<JSONObject> = {
  field: { summary: true },
  title: "Summary",
  fieldType: FormFieldSchemaType.LongText,
  stepId: "info",
};

const markdownField: Field<JSONObject> = {
  field: { note: true },
  title: "Note",
  fieldType: FormFieldSchemaType.Markdown,
  stepId: "note",
};

const STEPS: Array<{ title: string; id: string }> = [
  { title: "Info", id: "info" },
  { title: "Note", id: "note" },
];

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

afterEach(() => {
  cleanup();
});

describe("which forms count as having a Markdown editor", () => {
  test("one with a Markdown field, wherever it is in the form", () => {
    expect(hasMarkdownField([markdownField])).toBe(true);
    expect(hasMarkdownField([textField, longTextField, markdownField])).toBe(
      true,
    );
  });

  test("one whose Markdown field shows only on a condition: the dialog keeps its width", () => {
    expect(
      hasMarkdownField([
        textField,
        {
          ...markdownField,
          showIf: (): boolean => {
            return false;
          },
        },
      ]),
    ).toBe(true);
  });

  test("not one with only plain text, long text, code or HTML", () => {
    expect(hasMarkdownField([textField, longTextField])).toBe(false);
    expect(
      hasMarkdownField([
        { ...textField, fieldType: FormFieldSchemaType.HTML },
        { ...textField, fieldType: FormFieldSchemaType.JavaScript },
        { ...textField, fieldType: FormFieldSchemaType.CustomComponent },
      ]),
    ).toBe(false);
  });

  test("not a form with no fields", () => {
    expect(hasMarkdownField([])).toBe(false);
    expect(hasMarkdownField(undefined)).toBe(false);
    expect(hasMarkdownField(null)).toBe(false);
  });
});

describe("the width of a form's dialog", () => {
  test("is the wide dialog, Large, for a form with a Markdown editor", () => {
    expect(MARKDOWN_FORM_MODAL_WIDTH).toBe(ModalWidth.Large);

    for (const width of [
      undefined,
      ModalWidth.Normal,
      ModalWidth.Medium,
      ModalWidth.Large,
    ]) {
      expect(getFormModalWidth({ fields: [markdownField], width })).toBe(
        ModalWidth.Large,
      );
    }
  });

  test("is left as it was for every other form", () => {
    for (const width of [
      undefined,
      ModalWidth.Normal,
      ModalWidth.Medium,
      ModalWidth.Large,
    ]) {
      expect(
        getFormModalWidth({ fields: [textField, longTextField], width }),
      ).toBe(width);
    }
  });
});

function renderBasicFormModal(data: {
  fields: Array<Field<JSONObject>>;
  withSteps: boolean;
  modalWidth?: ModalWidth | undefined;
}): void {
  render(
    <BasicFormModal<JSONObject>
      title="Add Note"
      submitButtonText="Add Note"
      modalWidth={data.modalWidth}
      onClose={getJestMockFunction()}
      onSubmit={getJestMockFunction()}
      formProps={{
        id: "form-modal-width",
        disableAutofocus: true,
        steps: data.withSteps ? STEPS : undefined,
        fields: data.withSteps
          ? data.fields
          : data.fields.map((field: Field<JSONObject>) => {
              const withoutStep: Field<JSONObject> = { ...field };
              delete withoutStep.stepId;
              return withoutStep;
            }),
      }}
    />,
  );
}

describe("BasicFormModal", () => {
  test("opens a form with a Markdown editor wide", () => {
    renderBasicFormModal({
      fields: [textField, markdownField],
      withSteps: false,
    });

    expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Large]!);
    expect(dialog()).not.toHaveClass(WIDTH_CLASS[ModalWidth.Normal]!);
  });

  test("opens a stepped form with a Markdown editor wide, not Medium", () => {
    renderBasicFormModal({
      fields: [textField, markdownField],
      withSteps: true,
    });

    expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Large]!);
    expect(dialog()).not.toHaveClass(WIDTH_CLASS[ModalWidth.Medium]!);
  });

  test("opens it wide even when the page asked for a narrower dialog", () => {
    for (const modalWidth of [ModalWidth.Normal, ModalWidth.Medium]) {
      renderBasicFormModal({
        fields: [textField, markdownField],
        withSteps: true,
        modalWidth,
      });

      expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Large]!);
      cleanup();
    }
  });

  test("leaves every other form as it was: Normal, Medium with steps, or what the page asked for", () => {
    renderBasicFormModal({
      fields: [textField, longTextField],
      withSteps: false,
    });
    expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Normal]!);
    cleanup();

    renderBasicFormModal({
      fields: [textField, { ...longTextField, stepId: "note" }],
      withSteps: true,
    });
    expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Medium]!);
    cleanup();

    // A stepped dialog the page asked to keep Normal stays Normal.
    renderBasicFormModal({
      fields: [textField, { ...longTextField, stepId: "note" }],
      withSteps: true,
      modalWidth: ModalWidth.Normal,
    });
    expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Normal]!);
  });
});

function renderModelFormModal(data: {
  withMarkdown: boolean;
  withSteps: boolean;
  formType: FormType;
  modalWidth?: ModalWidth | undefined;
}): void {
  render(
    <ModelFormModal<IncidentNoteTemplate>
      title="Create New Incident Note Template"
      modelType={IncidentNoteTemplate}
      modalWidth={data.modalWidth}
      onClose={getJestMockFunction()}
      onSuccess={getJestMockFunction()}
      submitButtonText="Create Incident Note Template"
      formProps={{
        id: "create-IncidentNoteTemplate-from",
        name: "create-IncidentNoteTemplate-from",
        modelType: IncidentNoteTemplate,
        formType: data.formType,
        steps: data.withSteps
          ? [
              { title: "Template Info", id: "template-info" },
              { title: "Note Details", id: "note-details" },
            ]
          : [],
        fields: [
          {
            field: { templateName: true },
            title: "Template Name",
            fieldType: FormFieldSchemaType.Text,
            stepId: data.withSteps ? "template-info" : undefined,
            required: true,
          },
          {
            field: { note: true },
            title: "Note",
            fieldType: data.withMarkdown
              ? FormFieldSchemaType.Markdown
              : FormFieldSchemaType.LongText,
            stepId: data.withSteps ? "note-details" : undefined,
            required: true,
          },
        ],
      }}
    />,
  );
}

describe("ModelFormModal", () => {
  test("opens the note template's create form wide, step list and all", async () => {
    renderModelFormModal({
      withMarkdown: true,
      withSteps: true,
      formType: FormType.Create,
    });

    expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Large]!);
    expect(dialog()).not.toHaveClass(WIDTH_CLASS[ModalWidth.Medium]!);

    // The step list beside the fields, which the wide dialog leaves room for.
    const progress: HTMLElement = await screen.findByRole("navigation", {
      name: "Progress",
    });
    expect(progress).toHaveTextContent("Template Info");
    expect(progress).toHaveTextContent("Note Details");
    expect(dialog()).toContainElement(progress);
  });

  test("opens an edit form with a Markdown editor wide, with or without steps", () => {
    for (const withSteps of [false, true]) {
      renderModelFormModal({
        withMarkdown: true,
        withSteps,
        formType: FormType.Update,
      });

      expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Large]!);
      cleanup();
    }
  });

  test("opens it wide even when the page asked for a narrower dialog", () => {
    for (const modalWidth of [ModalWidth.Normal, ModalWidth.Medium]) {
      renderModelFormModal({
        withMarkdown: true,
        withSteps: false,
        formType: FormType.Create,
        modalWidth,
      });

      expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Large]!);
      cleanup();
    }
  });

  test("leaves the same form without its editor as it was", () => {
    renderModelFormModal({
      withMarkdown: false,
      withSteps: false,
      formType: FormType.Create,
    });
    expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Normal]!);
    cleanup();

    renderModelFormModal({
      withMarkdown: false,
      withSteps: true,
      formType: FormType.Create,
    });
    expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Medium]!);
    cleanup();

    renderModelFormModal({
      withMarkdown: false,
      withSteps: true,
      formType: FormType.Create,
      modalWidth: ModalWidth.Large,
    });
    expect(dialog()).toHaveClass(WIDTH_CLASS[ModalWidth.Large]!);
  });
});
