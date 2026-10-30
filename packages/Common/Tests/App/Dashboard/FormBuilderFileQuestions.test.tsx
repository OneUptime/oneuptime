import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
 * File questions in the form builder: the palette offers File and Multiple
 * Files questions of the form's own and the target's file custom fields,
 * a question's card pictures a drop zone, and the preview draws the public
 * page's own file picker - which keeps the files in the browser, so the
 * preview uploads nothing - and checks a required one as the page does.
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

const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
    },
  };
});

import FormPreviewModal from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/FormPreviewModal";
import QuestionInputPreview, {
  FORM_ANSWER_TYPE_ICONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/QuestionInputPreview";
import QuestionPalette, {
  PaletteItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/QuestionPalette";
import { getFormPaletteState } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderState";
import FormsCopy, {
  FORM_QUESTION_TYPE_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import { CUSTOM_FIELD_FILE_HINT } from "../../../UI/Components/CustomFields/CustomFieldFormFields";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import MimeType from "../../../Types/File/MimeType";
import IconProp from "../../../Types/Icon/IconProp";
import {
  FORM_QUESTION_TYPES,
  FormField,
  FormFieldSource,
} from "../../../Types/Form/FormField";
import { FormCustomFieldDefinition } from "../../../Types/Form/FormPublic";
import FormTargetType from "../../../Types/Form/FormTargetType";

const CONTRACT_FIELD_ID: string = "b0000000-0000-4000-8000-0000000000f1";

const CONTRACT_FIELD: FormCustomFieldDefinition = {
  id: CONTRACT_FIELD_ID,
  name: "Signed contract",
  customFieldType: CustomFieldType.File,
};

const EVIDENCE_FIELD: FormCustomFieldDefinition = {
  id: "b0000000-0000-4000-8000-0000000000f2",
  name: "Evidence",
  customFieldType: CustomFieldType.MultipleFiles,
};

afterEach(() => {
  cleanup();
  createMock.mockReset();
});

describe("the palette's file questions", () => {
  function renderPalette(
    onAdd: (item: PaletteItem) => void,
    customFields: Array<FormCustomFieldDefinition> = [],
  ): void {
    render(
      <MemoryRouter>
        <QuestionPalette
          targetType={FormTargetType.Incident}
          palette={getFormPaletteState({
            fields: [],
            targetType: FormTargetType.Incident,
            customFields: customFields,
          })}
          onAdd={onAdd}
        />
      </MemoryRouter>,
    );
  }

  test("File and Multiple Files are questions a form may ask of its own", () => {
    expect(FORM_QUESTION_TYPES).toContain(CustomFieldType.File);
    expect(FORM_QUESTION_TYPES).toContain(CustomFieldType.MultipleFiles);

    renderPalette(() => {});

    expect(
      screen.getByTestId(`form-palette-question-${CustomFieldType.File}`),
    ).toHaveTextContent("File");
    expect(
      screen.getByTestId(
        `form-palette-question-${CustomFieldType.MultipleFiles}`,
      ),
    ).toHaveTextContent(
      FORM_QUESTION_TYPE_TEXT[CustomFieldType.MultipleFiles].description,
    );
  });

  test("a File question is handed over by type, untitled", () => {
    const added: Array<PaletteItem> = [];

    renderPalette((item: PaletteItem) => {
      added.push(item);
    });

    fireEvent.click(
      screen.getByTestId(`form-palette-question-${CustomFieldType.File}`),
    );

    expect(added).toEqual([
      {
        kind: "question",
        type: CustomFieldType.File,
        label: FormsCopy.newQuestionLabel,
      },
    ]);
  });

  test("a file custom field is offered by name and type, to map the answer to", () => {
    const added: Array<PaletteItem> = [];

    renderPalette(
      (item: PaletteItem) => {
        added.push(item);
      },
      [CONTRACT_FIELD, EVIDENCE_FIELD],
    );

    const contract: HTMLElement = screen.getByTestId(
      `form-palette-custom-field-${CONTRACT_FIELD_ID}`,
    );

    expect(contract).toHaveTextContent("Signed contract");
    expect(contract).toHaveTextContent(
      FORM_QUESTION_TYPE_TEXT[CustomFieldType.File].title,
    );
    expect(
      screen.getByTestId(`form-palette-custom-field-${EVIDENCE_FIELD.id}`),
    ).toHaveTextContent(
      FORM_QUESTION_TYPE_TEXT[CustomFieldType.MultipleFiles].title,
    );

    fireEvent.click(contract);

    expect(added).toEqual([
      { kind: "customField", definition: CONTRACT_FIELD },
    ]);
  });
});

describe("a file question's card", () => {
  test("pictures a drop zone for one file", () => {
    const { container } = render(
      <QuestionInputPreview answerType={CustomFieldType.File} />,
    );

    expect(container).toHaveTextContent(FormsCopy.inputFile);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  test("pictures a drop zone for several", () => {
    const { container } = render(
      <QuestionInputPreview answerType={CustomFieldType.MultipleFiles} />,
    );

    expect(container).toHaveTextContent(FormsCopy.inputFiles);
  });

  test("has an icon of its own in the palette and on cards", () => {
    expect(FORM_ANSWER_TYPE_ICONS[CustomFieldType.File]).toBe(
      IconProp.PaperClip,
    );
    expect(FORM_ANSWER_TYPE_ICONS[CustomFieldType.MultipleFiles]).toBe(
      IconProp.DocumentDuplicate,
    );
  });
});

describe("the preview of a file question", () => {
  const SCREENSHOT: FormField = {
    id: "shot",
    source: FormFieldSource.Question,
    type: CustomFieldType.File,
    label: "A screenshot",
    isRequired: true,
  };

  const CONTRACT: FormField = {
    id: "contract",
    source: FormFieldSource.TargetCustomField,
    customFieldId: CONTRACT_FIELD_ID,
    label: "Your signed contract",
    isRequired: false,
  };

  async function renderPreview(fields: Array<FormField>): Promise<void> {
    await act(async () => {
      render(
        <FormPreviewModal
          name="Report a Problem"
          description="Tell us what is wrong."
          fields={fields}
          targetType={FormTargetType.Incident}
          customFields={[CONTRACT_FIELD]}
          recordOptions={{}}
          defaultOptionValues={{}}
          onClose={() => {}}
        />,
      );
    });
  }

  test("draws the public page's file picker, saying what it takes", async () => {
    await renderPreview([SCREENSHOT, CONTRACT]);

    const shot: HTMLElement = screen.getByTestId("form-preview-field-shot");

    expect(within(shot).getByText("Upload a file")).toBeInTheDocument();
    expect(within(shot).getByText(CUSTOM_FIELD_FILE_HINT)).toBeInTheDocument();
    expect(
      screen.getByTestId("form-preview-field-contract"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("form-preview")).toHaveTextContent(
      "Your signed contract",
    );
  });

  test("a required file question must be answered, as on the page", async () => {
    await renderPreview([SCREENSHOT]);

    await act(async () => {
      fireEvent.click(
        document.getElementById("form-preview-form-submit-button")!,
      );
    });

    expect(
      await screen.findByText("A screenshot is required."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("form-preview-submitted"),
    ).not.toBeInTheDocument();
  });

  test("a file chosen in the preview stays in the browser: nothing is uploaded, nothing submitted", async () => {
    await renderPreview([SCREENSHOT]);

    // Over its own ArrayBuffer, as a File's parts must be.
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const file: File = new File([bytes], "outage.png", {
      type: MimeType.png,
    });
    file.arrayBuffer = async (): Promise<ArrayBuffer> => {
      return bytes.slice().buffer;
    };

    await act(async () => {
      fireEvent.drop(
        screen.getByTestId("form-preview-field-shot")
          .firstElementChild as HTMLElement,
        { dataTransfer: { files: [file], types: ["Files"] } },
      );
    });

    expect(await screen.findByText("outage.png")).toBeInTheDocument();
    // Kept, not uploaded: a picker of one lists its file with no heading.
    expect(screen.queryByText("Uploaded files")).not.toBeInTheDocument();
    expect(screen.getByText("PNG • 8 B")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();

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
    expect(createMock).not.toHaveBeenCalled();
  });
});
