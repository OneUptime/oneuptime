import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  CUSTOM_FIELD_FILE_HINT,
  CUSTOM_FIELD_FILE_PLACEHOLDER,
  CUSTOM_FIELD_FILES_HINT,
} from "../../../UI/Components/CustomFields/CustomFieldFormFields";
import {
  buildPublicFormFields,
  getPublicFormFilesProblem,
  getPublicFormValuesFromAnswers,
  packPublicFormAnswers,
} from "../../../UI/Components/PublicForm/PublicFormFields";
import FileModel from "../../../Models/DatabaseModels/File";
import {
  CUSTOM_FIELD_FILE_TYPES,
  CUSTOM_FIELD_MAX_FILES,
} from "../../../Types/CustomField/CustomFieldFile";
import MimeType from "../../../Types/File/MimeType";
import {
  encodeBase64,
  FORM_FILE_MAX_SIZE_IN_BYTES,
  FormFileAnswer,
} from "../../../Types/Form/FormFileAnswer";
import {
  FORM_SUBMISSION_FILES_TOO_LARGE_MESSAGE,
  FORM_SUBMISSION_TOO_MANY_FILES_MESSAGE,
  PublicForm,
  PublicFormFieldType,
  validateFormSubmission,
} from "../../../Types/Form/FormPublic";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A form's file questions on its public page (and in the builder's preview):
 * a picker that keeps the files in the browser - there may be nobody signed
 * in to upload them as - and takes what the server takes, the files sent
 * with the answers as { name, fileType, data } in base64, and a whole
 * submission's files checked before anything is sent, in the server's own
 * sentences.
 */

const FORM: PublicForm = {
  name: "Report a Problem",
  fields: [
    {
      id: "title",
      label: "What is wrong?",
      type: PublicFormFieldType.Text,
      isRequired: true,
      maxLength: 500,
    },
    {
      id: "contract",
      label: "Signed contract",
      helpText: "The PDF you signed.",
      type: PublicFormFieldType.File,
      isRequired: true,
      fileTypes: [...CUSTOM_FIELD_FILE_TYPES],
      maxFileSizeInBytes: FORM_FILE_MAX_SIZE_IN_BYTES,
    },
    {
      id: "screenshots",
      label: "Screenshots",
      type: PublicFormFieldType.MultipleFiles,
      isRequired: false,
      fileTypes: [...CUSTOM_FIELD_FILE_TYPES],
      maxFileSizeInBytes: FORM_FILE_MAX_SIZE_IN_BYTES,
      maxFiles: 4,
    },
  ],
};

const PDF: Uint8Array = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const PNG: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

type KeptFunction = (
  name: string,
  fileType: MimeType,
  bytes: Uint8Array,
) => FileModel;

// A file as a picker that keeps its files in the browser hands it back.
const kept: KeptFunction = (
  name: string,
  fileType: MimeType,
  bytes: Uint8Array,
): FileModel => {
  const file: FileModel = new FileModel();
  file.name = name;
  file.fileType = fileType;
  file.file = Buffer.from(bytes);
  return file;
};

type FieldOfFunction = (id: string) => Field<JSONObject>;

const fieldOf: FieldOfFunction = (id: string): Field<JSONObject> => {
  return buildPublicFormFields(FORM).find(
    (field: Field<JSONObject>): boolean => {
      return Object.keys(field.field || {})[0] === `answer_${id}`;
    },
  )!;
};

describe("a file question's input", () => {
  test("a File question is a picker of one file, kept in the browser, that says what it takes", () => {
    const field: Field<JSONObject> = fieldOf("contract");

    expect(field.fieldType).toBe(FormFieldSchemaType.File);
    expect(field.keepFilesInBrowser).toBe(true);
    expect(field.fileTypes).toEqual([...CUSTOM_FIELD_FILE_TYPES]);
    expect(field.fileHint).toBe(CUSTOM_FIELD_FILE_HINT);
    expect(field.placeholder).toBe(CUSTOM_FIELD_FILE_PLACEHOLDER);
    expect(field.maxFileSizeInBytes).toBe(FORM_FILE_MAX_SIZE_IN_BYTES);
    expect(field.maxFiles).toBeUndefined();
    expect(field.required).toBe(true);
  });

  test("a Multiple files question is a picker of as many files as the question takes", () => {
    const field: Field<JSONObject> = fieldOf("screenshots");

    expect(field.fieldType).toBe(FormFieldSchemaType.MultipleFiles);
    expect(field.keepFilesInBrowser).toBe(true);
    expect(field.maxFiles).toBe(4);
    expect(field.fileHint).toBe(CUSTOM_FIELD_FILES_HINT);
  });

  test("a Multiple files question the page is told no limit for takes what a Multiple files field holds", () => {
    const fields: Array<Field<JSONObject>> = buildPublicFormFields({
      name: "Form",
      fields: [
        {
          id: "logs",
          label: "Logs",
          type: PublicFormFieldType.MultipleFiles,
          isRequired: false,
        },
      ],
    });

    expect(fields[0]!.maxFiles).toBe(CUSTOM_FIELD_MAX_FILES);
  });

  test("a question that is no file question keeps its files out of the browser's hands", () => {
    const field: Field<JSONObject> = fieldOf("title");

    expect(field.keepFilesInBrowser).toBeUndefined();
    expect(field.fileHint).toBeUndefined();
  });
});

describe("packPublicFormAnswers: the files, as the server reads them", () => {
  test("one file for a File question, a list for a Multiple files one, each in base64", () => {
    const answers: JSONObject = packPublicFormAnswers({
      form: FORM,
      values: {
        answer_title: "Down",
        answer_contract: [kept("contract.pdf", MimeType.pdf, PDF)] as never,
        answer_screenshots: [
          kept("one.png", MimeType.png, PNG),
          kept("two.png", MimeType.png, PNG),
        ] as never,
      },
    });

    expect(answers).toEqual({
      title: "Down",
      contract: {
        name: "contract.pdf",
        fileType: MimeType.pdf,
        data: Buffer.from(PDF).toString("base64"),
      },
      screenshots: [
        {
          name: "one.png",
          fileType: MimeType.png,
          data: Buffer.from(PNG).toString("base64"),
        },
        {
          name: "two.png",
          fileType: MimeType.png,
          data: Buffer.from(PNG).toString("base64"),
        },
      ],
    });
  });

  test("a file on its own, not in a list, is sent too", () => {
    const answers: JSONObject = packPublicFormAnswers({
      form: FORM,
      values: {
        answer_contract: kept("contract.pdf", MimeType.pdf, PDF) as never,
      },
    });

    expect((answers["contract"] as unknown as FormFileAnswer).name).toBe(
      "contract.pdf",
    );
  });

  test("only a file's own bytes are sent, wherever in memory they sit", () => {
    const pool: Buffer = Buffer.concat([
      Buffer.from("before"),
      Buffer.from(PDF),
      Buffer.from("after"),
    ]);
    const file: FileModel = new FileModel();
    file.name = "contract.pdf";
    file.fileType = MimeType.pdf;
    file.file = pool.subarray(6, 6 + PDF.length);

    const answers: JSONObject = packPublicFormAnswers({
      form: FORM,
      values: { answer_contract: [file] as never },
    });

    expect((answers["contract"] as unknown as FormFileAnswer).data).toBe(
      encodeBase64(PDF),
    );
  });

  test("a file the picker holds no bytes of - one stored already - is never sent, nor is no file", () => {
    const stored: FileModel = new FileModel();
    stored.name = "stored.pdf";
    stored.fileType = MimeType.pdf;

    expect(
      packPublicFormAnswers({
        form: FORM,
        values: {
          answer_contract: [stored] as never,
          answer_screenshots: [] as never,
        },
      }),
    ).toEqual({});
    expect(
      packPublicFormAnswers({
        form: FORM,
        values: { answer_contract: null, answer_screenshots: "x.png" },
      }),
    ).toEqual({});
  });

  test("what it packs is what the server accepts", () => {
    const answers: JSONObject = packPublicFormAnswers({
      form: FORM,
      values: {
        answer_title: "Down",
        answer_contract: [kept("contract.pdf", MimeType.pdf, PDF)] as never,
        answer_screenshots: [kept("one.png", MimeType.png, PNG)] as never,
      },
    });

    expect(
      validateFormSubmission({ fields: FORM.fields, data: { answers } }),
    ).toEqual({ isValid: true, answers });
  });
});

describe("getPublicFormFilesProblem: a submission's files, all its questions together", () => {
  test("files that fit are no problem", () => {
    expect(
      getPublicFormFilesProblem({
        form: FORM,
        values: {
          answer_contract: [kept("contract.pdf", MimeType.pdf, PDF)] as never,
          answer_screenshots: [kept("one.png", MimeType.png, PNG)] as never,
        },
      }),
    ).toBeNull();
    expect(getPublicFormFilesProblem({ form: FORM, values: {} })).toBeNull();
  });

  test("more than 10 files across the questions is too many, in the server's sentence", () => {
    const files: Array<FileModel> = [];

    for (let index: number = 0; index < 10; index++) {
      files.push(kept(`shot-${index}.png`, MimeType.png, PNG));
    }

    // Ten in one question and one in the other: eleven.
    expect(
      getPublicFormFilesProblem({
        form: FORM,
        values: {
          answer_contract: [kept("contract.pdf", MimeType.pdf, PDF)] as never,
          answer_screenshots: files as never,
        },
      }),
    ).toBe(FORM_SUBMISSION_TOO_MANY_FILES_MESSAGE);

    // Ten together fit.
    expect(
      getPublicFormFilesProblem({
        form: FORM,
        values: { answer_screenshots: files as never },
      }),
    ).toBeNull();
  });

  test("more than 20 MB together is too large, though each file fits", () => {
    const nineMegabytes: Uint8Array = new Uint8Array(9 * 1024 * 1024);

    expect(
      getPublicFormFilesProblem({
        form: FORM,
        values: {
          answer_contract: [
            kept("big.pdf", MimeType.pdf, nineMegabytes),
          ] as never,
          answer_screenshots: [
            kept("a.png", MimeType.png, nineMegabytes),
            kept("b.png", MimeType.png, nineMegabytes),
          ] as never,
        },
      }),
    ).toBe(FORM_SUBMISSION_FILES_TOO_LARGE_MESSAGE);

    expect(
      getPublicFormFilesProblem({
        form: FORM,
        values: {
          answer_contract: [
            kept("big.pdf", MimeType.pdf, nineMegabytes),
          ] as never,
          answer_screenshots: [
            kept("a.png", MimeType.png, nineMegabytes),
          ] as never,
        },
      }),
    ).toBeNull();
  });

  test("a value a question that is no file question holds is never counted", () => {
    const files: Array<FileModel> = [];

    for (let index: number = 0; index < 11; index++) {
      files.push(kept(`shot-${index}.png`, MimeType.png, PNG));
    }

    expect(
      getPublicFormFilesProblem({
        form: FORM,
        values: { answer_title: files as never },
      }),
    ).toBeNull();
  });
});

describe("a template and a file question", () => {
  test("a template's answer never fills a file question in", () => {
    expect(
      getPublicFormValuesFromAnswers({
        fields: FORM.fields,
        answers: {
          title: "Down",
          contract: {
            name: "contract.pdf",
            fileType: MimeType.pdf,
            data: encodeBase64(PDF),
          },
          screenshots: "one.png",
        },
      }),
    ).toEqual({ answer_title: "Down" });
  });
});
