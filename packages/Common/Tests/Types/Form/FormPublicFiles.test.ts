import { CUSTOM_FIELD_FILE_TYPES } from "../../../Types/CustomField/CustomFieldFile";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import MimeType from "../../../Types/File/MimeType";
import {
  createQuestionField,
  createTargetField,
  FormField,
  FormFieldSource,
} from "../../../Types/Form/FormField";
import {
  encodeBase64,
  FORM_FILE_MAX_SIZE_IN_BYTES,
  FormFileAnswer,
} from "../../../Types/Form/FormFileAnswer";
import {
  BuiltPublicForm,
  buildPublicForm,
  FORM_SUBMISSION_FILES_TOO_LARGE_MESSAGE,
  FORM_SUBMISSION_TOO_MANY_FILES_MESSAGE,
  FormSubmissionValidationResult,
  getFormFileAnswerFiles,
  getFormTemplateAnswers,
  isPublicFormFileField,
  PUBLIC_FORM_FILE_FIELD_TYPES,
  PublicFormField,
  PublicFormFieldType,
  validateFormSubmission,
  validateFormTemplateAnswers,
} from "../../../Types/Form/FormPublic";
import {
  FormSubmissionAnswer,
  getFormAnswerDisplayValue,
  getFormSubmissionAnswers,
} from "../../../Types/Form/FormSubmissionAnswer";
import { getFormTargetFields } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A form's file questions, from what the public page is told to what a
 * stranger's submission is held to. A file question is one of the form's
 * own (File or Multiple Files), or a question linked to one of the
 * target's File or Multiple files custom fields. Each file is sent as
 * { name, fileType, data } with its bytes in base64 and checked like a file
 * custom field's - a name, a kind a field takes, at most 10 MB, holding what
 * its type says - and a submission carries at most 10 files and 20 MB.
 */

const CF_CONTRACT: string = "0e0e0e0e-0000-4000-8000-000000000001";
const CF_SCREENSHOTS: string = "0e0e0e0e-0000-4000-8000-000000000002";

const PDF: Uint8Array = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const PNG: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const HTML: Uint8Array = new TextEncoder().encode("<html><script></script>");

type FileOfFunction = (
  name: string,
  fileType: string,
  bytes: Uint8Array,
) => FormFileAnswer;

const fileOf: FileOfFunction = (
  name: string,
  fileType: string,
  bytes: Uint8Array,
): FormFileAnswer => {
  return { name: name, fileType: fileType, data: encodeBase64(bytes) };
};

const PDF_FILE: FormFileAnswer = fileOf("contract.pdf", MimeType.pdf, PDF);
const PNG_FILE: FormFileAnswer = fileOf("outage.png", MimeType.png, PNG);

const titleQuestion: FormField = createTargetField({
  definition: getFormTargetFields(FormTargetType.Incident).find(
    (definition: { key: string }): boolean => {
      return definition.key === "title";
    },
  )!,
  id: "title",
});

const ownFile: FormField = {
  ...createQuestionField({
    type: CustomFieldType.File,
    label: "Screenshot",
    id: "screenshot",
  }),
};

const ownFiles: FormField = createQuestionField({
  type: CustomFieldType.MultipleFiles,
  label: "Logs",
  id: "logs",
});

const linkedFile: FormField = {
  id: "contract",
  source: FormFieldSource.TargetCustomField,
  label: "Signed Contract",
  isRequired: false,
  customFieldId: CF_CONTRACT,
};

const linkedFiles: FormField = {
  id: "screenshots",
  source: FormFieldSource.TargetCustomField,
  label: "Screenshots",
  isRequired: false,
  customFieldId: CF_SCREENSHOTS,
};

type BuildFunction = (
  fields: Array<FormField>,
  templates?: unknown,
) => BuiltPublicForm;

const build: BuildFunction = (
  fields: Array<FormField>,
  templates?: unknown,
): BuiltPublicForm => {
  return buildPublicForm({
    form: {
      name: "Report",
      fields: fields,
      targetType: FormTargetType.Incident,
      templates: templates,
    },
    customFields: [
      {
        id: CF_CONTRACT,
        name: "Contract",
        customFieldType: CustomFieldType.File,
      },
      {
        id: CF_SCREENSHOTS,
        name: "Screenshots",
        customFieldType: CustomFieldType.MultipleFiles,
      },
    ],
    recordOptions: {},
    isCaptchaRequired: false,
  });
};

type FieldOfFunction = (built: BuiltPublicForm, id: string) => PublicFormField;

const fieldOf: FieldOfFunction = (
  built: BuiltPublicForm,
  id: string,
): PublicFormField => {
  return built.form.fields.find((field: PublicFormField): boolean => {
    return field.id === id;
  })!;
};

type SubmitFunction = (
  fields: Array<FormField>,
  answers: JSONObject,
) => FormSubmissionValidationResult;

const submit: SubmitFunction = (
  fields: Array<FormField>,
  answers: JSONObject,
): FormSubmissionValidationResult => {
  return validateFormSubmission({
    fields: build(fields).form.fields,
    data: { answers: answers },
  });
};

type ErrorsOfFunction = (
  result: FormSubmissionValidationResult,
) => Array<string>;

const errorsOf: ErrorsOfFunction = (
  result: FormSubmissionValidationResult,
): Array<string> => {
  return result.isValid ? [] : result.errors;
};

describe("the public page is told about a file question", () => {
  test("a question of the form's own is a File or Multiple files question, with what it takes", () => {
    const built: BuiltPublicForm = build([titleQuestion, ownFile, ownFiles]);

    expect(fieldOf(built, "screenshot")).toEqual({
      id: "screenshot",
      label: "Screenshot",
      type: PublicFormFieldType.File,
      isRequired: false,
      fileTypes: [...CUSTOM_FIELD_FILE_TYPES],
      maxFileSizeInBytes: FORM_FILE_MAX_SIZE_IN_BYTES,
    });
    expect(fieldOf(built, "logs").type).toBe(PublicFormFieldType.MultipleFiles);
    expect(fieldOf(built, "logs").maxFiles).toBe(10);
    expect(fieldOf(built, "logs").maxLength).toBeUndefined();
  });

  test("a question linked to a file custom field is asked for its files the same way, and binds to it", () => {
    const built: BuiltPublicForm = build([
      titleQuestion,
      linkedFile,
      linkedFiles,
    ]);

    expect(fieldOf(built, "contract").type).toBe(PublicFormFieldType.File);
    expect(fieldOf(built, "screenshots").type).toBe(
      PublicFormFieldType.MultipleFiles,
    );
    expect(fieldOf(built, "screenshots").maxFiles).toBe(10);
    expect(built.bindings["contract"]).toEqual({
      source: FormFieldSource.TargetCustomField,
      label: "Signed Contract",
      customFieldId: CF_CONTRACT,
      customFieldName: "Contract",
      customFieldType: CustomFieldType.File,
    });
  });

  test("never names the custom field to the page", () => {
    const told: string = JSON.stringify(build([linkedFile]).form);

    expect(told).not.toContain(CF_CONTRACT);
    expect(told).not.toContain("customField");
  });

  test("file question types are File and MultipleFiles", () => {
    expect(PUBLIC_FORM_FILE_FIELD_TYPES).toEqual([
      PublicFormFieldType.File,
      PublicFormFieldType.MultipleFiles,
    ]);
    expect(isPublicFormFileField({ type: PublicFormFieldType.File })).toBe(
      true,
    );
    expect(isPublicFormFileField({ type: PublicFormFieldType.Text })).toBe(
      false,
    );
  });
});

describe("a submission's file answers", () => {
  test("one file for a File question, kept as it was sent once it passes", () => {
    const result: FormSubmissionValidationResult = submit([ownFile], {
      screenshot: PNG_FILE as unknown as JSONObject,
    });

    expect(result.isValid).toBe(true);
    expect(result.isValid && result.answers["screenshot"]).toEqual(PNG_FILE);
  });

  test("a list for a Multiple files question, or one on its own", () => {
    const listed: FormSubmissionValidationResult = submit([ownFiles], {
      logs: [PDF_FILE, PNG_FILE] as unknown as JSONObject[],
    });
    const single: FormSubmissionValidationResult = submit([ownFiles], {
      logs: PDF_FILE as unknown as JSONObject,
    });

    expect(listed.isValid && listed.answers["logs"]).toEqual([
      PDF_FILE,
      PNG_FILE,
    ]);
    expect(single.isValid && single.answers["logs"]).toEqual([PDF_FILE]);
  });

  test("a file's name is cleaned, and its type read in lower case", () => {
    const result: FormSubmissionValidationResult = submit([ownFile], {
      screenshot: {
        ...PNG_FILE,
        name: "C:\\fakepath\\out\u0000age.png",
        fileType: " IMAGE/PNG ",
      },
    });

    expect(result.isValid && result.answers["screenshot"]).toEqual({
      ...PNG_FILE,
      name: "outage.png",
      fileType: MimeType.png,
    });
  });

  test("a list for a File question is refused", () => {
    expect(
      errorsOf(
        submit([ownFile], {
          screenshot: [PNG_FILE] as unknown as JSONObject[],
        }),
      ),
    ).toEqual(["Screenshot takes one file."]);
  });

  test("more than 10 files in a question is refused, before any is read", () => {
    const files: Array<FormFileAnswer> = new Array(11).fill(PNG_FILE);

    expect(
      errorsOf(submit([ownFiles], { logs: files as unknown as JSONObject[] })),
    ).toEqual(["Logs takes at most 10 files."]);
  });

  test("a file without a name, a type or its contents is refused", () => {
    for (const bad of [
      { fileType: MimeType.pdf, data: PDF_FILE.data },
      { name: "a.pdf", data: PDF_FILE.data },
      { name: "a.pdf", fileType: MimeType.pdf },
      { name: "   ", fileType: MimeType.pdf, data: PDF_FILE.data },
      "a.pdf",
      42,
      [[PDF_FILE]],
    ]) {
      expect(errorsOf(submit([ownFiles], { logs: bad as never }))).toEqual([
        "Logs takes a file chosen on the form, with its name, its type and its contents.",
      ]);
    }
  });

  test("a kind of file a field does not take is refused", () => {
    for (const fileType of [
      MimeType.svg,
      "text/html",
      "application/x-msdownload",
    ]) {
      expect(
        errorsOf(
          submit([ownFile], {
            screenshot: { ...PNG_FILE, fileType: fileType },
          }),
        ),
      ).toEqual([
        "Screenshot takes PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP files.",
      ]);
    }
  });

  test("a file larger than 10 MB is refused by its length, before it is read", () => {
    // A base64 text of 10 MB and a few bytes: refused by its length alone.
    const tooLarge: string = "A".repeat(
      4 * Math.ceil((FORM_FILE_MAX_SIZE_IN_BYTES + 1) / 3),
    );

    expect(
      errorsOf(
        submit([ownFile], {
          screenshot: {
            name: "big.png",
            fileType: MimeType.png,
            data: tooLarge,
          },
        }),
      ),
    ).toEqual(["Each file in Screenshot can be at most 10 MB."]);
  });

  test("an empty file is refused", () => {
    expect(
      errorsOf(
        submit([ownFile], {
          screenshot: { name: "empty.png", fileType: MimeType.png, data: "" },
        }),
      ),
    ).toEqual(["A file in Screenshot is empty."]);
  });

  test("contents that are not base64 are refused", () => {
    expect(
      errorsOf(
        submit([ownFile], {
          screenshot: { ...PNG_FILE, data: "not base64!" },
        }),
      ),
    ).toEqual([
      "Screenshot takes a file chosen on the form, with its name, its type and its contents.",
    ]);
  });

  test("a file that does not hold what its type says is refused: a page renamed .pdf", () => {
    expect(
      errorsOf(
        submit([linkedFile], {
          contract: fileOf(
            "invoice.pdf",
            MimeType.pdf,
            HTML,
          ) as unknown as JSONObject,
        }),
      ),
    ).toEqual([
      "A file in Signed Contract does not hold what its type says. Upload the file as it was saved.",
    ]);
  });

  test("a required file question must be answered", () => {
    const required: FormField = { ...ownFile, isRequired: true };

    expect(errorsOf(submit([required], {}))).toEqual([
      "Screenshot is required.",
    ]);
    expect(errorsOf(submit([required], { screenshot: [] }))).toEqual([
      "Screenshot is required.",
    ]);
  });

  test("an optional file question left empty is left out", () => {
    const result: FormSubmissionValidationResult = submit([ownFile], {
      screenshot: null,
    });

    expect(result.isValid && result.answers).toEqual({});
  });

  test("a text question still refuses an object, file-shaped or not", () => {
    const text: FormField = createQuestionField({
      type: CustomFieldType.Text,
      label: "What broke?",
      id: "what",
    });

    expect(
      errorsOf(submit([text], { what: PDF_FILE as unknown as JSONObject })),
    ).toEqual(["What broke? takes one answer, not an object."]);
  });
});

describe("a submission's files, all its questions together", () => {
  test("at most 10 files", () => {
    const six: Array<FormFileAnswer> = new Array(6).fill(PNG_FILE);
    const five: Array<FormFileAnswer> = new Array(5).fill(PNG_FILE);

    expect(
      errorsOf(
        submit([ownFiles, linkedFiles], {
          logs: six as unknown as JSONObject[],
          screenshots: five as unknown as JSONObject[],
        }),
      ),
    ).toEqual([FORM_SUBMISSION_TOO_MANY_FILES_MESSAGE]);

    expect(
      submit([ownFiles, linkedFiles], {
        logs: five as unknown as JSONObject[],
        screenshots: five as unknown as JSONObject[],
      }).isValid,
    ).toBe(true);
  });

  test("at most 20 MB together", () => {
    // Three files of 9 MB: each fits, together they do not.
    const big: FormFileAnswer = fileOf(
      "dump.pdf",
      MimeType.pdf,
      (() => {
        const bytes: Uint8Array = new Uint8Array(9 * 1024 * 1024).fill(0x20);
        bytes.set(PDF, 0);
        return bytes;
      })(),
    );

    expect(
      errorsOf(
        submit([ownFiles], {
          logs: [big, big, big] as unknown as JSONObject[],
        }),
      ),
    ).toEqual([FORM_SUBMISSION_FILES_TOO_LARGE_MESSAGE]);

    expect(
      submit([ownFiles], { logs: [big, big] as unknown as JSONObject[] })
        .isValid,
    ).toBe(true);
  });

  test("the whole-submission sentences are the ones the page knows", () => {
    expect(FORM_SUBMISSION_TOO_MANY_FILES_MESSAGE).toBe(
      "A response can carry at most 10 files.",
    );
    expect(FORM_SUBMISSION_FILES_TOO_LARGE_MESSAGE).toBe(
      "The files of a response can be at most 20 MB together.",
    );
  });
});

describe("templates and file questions", () => {
  test("a template never answers a file question, whatever it holds", () => {
    const built: BuiltPublicForm = build([titleQuestion, ownFile]);

    expect(
      getFormTemplateAnswers({
        template: {
          answers: {
            title: "Printer on fire",
            screenshot: "outage.png",
          },
        },
        fields: built.allFields,
      }),
    ).toEqual({ title: "Printer on fire" });
  });

  test("saving a template that answers a file question is refused, saying why", () => {
    const built: BuiltPublicForm = build([titleQuestion, ownFile]);

    expect(
      validateFormTemplateAnswers({
        templates: [
          {
            id: "printer",
            name: "Printer",
            // An object is no template answer at all (validateFormTemplates).
            answers: { screenshot: "outage.png" },
          },
        ],
        fields: built.allFields,
      }),
    ).toBe(
      'Template 1 ("Printer"): Screenshot takes files, which whoever fills the form in chooses. A template cannot answer it.',
    );
  });

  test("a template may still ask a file question its own way", () => {
    const built: BuiltPublicForm = build(
      [titleQuestion, ownFile],
      [
        {
          id: "printer",
          name: "Printer",
          answers: {},
          fieldSettings: { screenshot: "Required" },
        },
      ],
    );

    expect(built.form.templates![0]!.fieldSettings).toEqual({
      screenshot: "Required",
    });
  });
});

describe("what a submission keeps, and the note says", () => {
  const STORED: Record<string, unknown> = {
    fileId: "aaaaaaaa-0000-4000-8000-000000000001",
    name: "outage.png",
    fileType: MimeType.png,
    size: 11,
  };

  test("a stored file reads as its name", () => {
    const field: PublicFormField = fieldOf(build([ownFiles]), "logs");

    expect(
      getFormAnswerDisplayValue(field, [
        STORED,
        {
          ...STORED,
          fileId: "aaaaaaaa-0000-4000-8000-000000000002",
          name: "b.log",
        },
      ] as unknown as JSONObject[]),
    ).toBe("outage.png, b.log");
  });

  test("a file as it was sent reads as its name, never its contents", () => {
    const field: PublicFormField = fieldOf(build([ownFile]), "screenshot");
    const shown: string = getFormAnswerDisplayValue(
      field,
      PNG_FILE as unknown as JSONObject,
    );

    expect(shown).toBe("outage.png");
    expect(shown).not.toContain(PNG_FILE.data);
  });

  test("the submission's answers name the stored files", () => {
    const built: BuiltPublicForm = build([ownFile]);
    const answers: Array<FormSubmissionAnswer> = getFormSubmissionAnswers({
      fields: built.allFields,
      answers: { screenshot: STORED as unknown as JSONObject },
    });

    expect(answers).toEqual([
      {
        fieldId: "screenshot",
        label: "Screenshot",
        value: STORED,
        displayValue: "outage.png",
      },
    ]);
  });

  test("getFormFileAnswerFiles reads the files of an answer, one or a list", () => {
    expect(getFormFileAnswerFiles(PDF_FILE)).toEqual([PDF_FILE]);
    expect(getFormFileAnswerFiles([PDF_FILE, PNG_FILE, "x", null])).toEqual([
      PDF_FILE,
      PNG_FILE,
    ]);
    expect(getFormFileAnswerFiles(undefined)).toEqual([]);
  });
});
