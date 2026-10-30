import {
  buildCustomFieldFormFields,
  CUSTOM_FIELD_FILE_HINT,
  CUSTOM_FIELD_FILE_PLACEHOLDER,
  CUSTOM_FIELD_FILES_HINT,
  CustomFieldFormDefinition,
  fromCustomFieldFileFormValue,
  setCustomFieldFilePicker,
  toCustomFieldFileFormValue,
} from "../../../../UI/Components/CustomFields/CustomFieldFormFields";
import {
  getCustomFieldFormInitialValues,
  getCustomFieldFormKey,
  packCustomFieldFormValues,
} from "../../../../UI/Components/CustomFields/CustomFieldModelFormFields";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FileModel from "../../../../Models/DatabaseModels/File";
import {
  CUSTOM_FIELD_FILE_TYPES,
  CUSTOM_FIELD_MAX_FILES,
  CustomFieldFile,
} from "../../../../Types/CustomField/CustomFieldFile";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import MimeType from "../../../../Types/File/MimeType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A file custom field in a form: a picker that takes what the field takes,
 * starting from the files the record holds, and what it holds handed back
 * as the files it names - { fileId, name, fileType }, the server reading the
 * rest from the file itself - one for a File field, a list for a Multiple
 * files one.
 */

const CONTRACT: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "signed-contract.pdf",
  fileType: MimeType.pdf,
  size: 48213,
};

const PHOTO: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "rack.png",
  fileType: MimeType.png,
  size: 2048,
};

const FILE_FIELD: CustomFieldFormDefinition = {
  name: "Contract",
  customFieldType: CustomFieldType.File,
};

const FILES_FIELD: CustomFieldFormDefinition = {
  name: "Photos",
  customFieldType: CustomFieldType.MultipleFiles,
};

type UploadedFunction = (file: CustomFieldFile) => FileModel;

// A file as the picker holds it once it is uploaded: a File with its id.
const uploaded: UploadedFunction = (file: CustomFieldFile): FileModel => {
  const model: FileModel = new FileModel(new ObjectID(file.fileId));
  model.name = file.name;
  model.fileType = file.fileType as MimeType;
  return model;
};

describe("setCustomFieldFilePicker", () => {
  test("a File field: the kinds a field takes, one file, said in a sentence", () => {
    const field: Field<JSONObject> = { title: "Contract" };

    setCustomFieldFilePicker({ field: field, isMultiple: false });

    expect(field.fileTypes).toEqual([...CUSTOM_FIELD_FILE_TYPES]);
    expect(field.fileHint).toBe(CUSTOM_FIELD_FILE_HINT);
    expect(field.placeholder).toBe(CUSTOM_FIELD_FILE_PLACEHOLDER);
    expect(field.maxFiles).toBeUndefined();
  });

  test("a Multiple files field: no more files than it holds", () => {
    const field: Field<JSONObject> = { title: "Photos" };

    setCustomFieldFilePicker({ field: field, isMultiple: true });

    expect(field.maxFiles).toBe(CUSTOM_FIELD_MAX_FILES);
    expect(field.fileHint).toBe(CUSTOM_FIELD_FILES_HINT);
    expect(field.placeholder).toBeUndefined();
  });

  test("a question that takes fewer says so", () => {
    const field: Field<JSONObject> = { title: "Photos" };

    setCustomFieldFilePicker({ field: field, isMultiple: true, maxFiles: 3 });

    expect(field.maxFiles).toBe(3);
  });

  test("its list of kinds is its own: changing it changes no other picker's", () => {
    const first: Field<JSONObject> = { title: "A" };
    const second: Field<JSONObject> = { title: "B" };

    setCustomFieldFilePicker({ field: first, isMultiple: false });
    setCustomFieldFilePicker({ field: second, isMultiple: false });
    first.fileTypes!.pop();

    expect(second.fileTypes).toEqual([...CUSTOM_FIELD_FILE_TYPES]);
  });

  test("the sentences say what the server holds a file to", () => {
    expect(CUSTOM_FIELD_FILE_HINT).toContain("10 MB");
    expect(CUSTOM_FIELD_FILES_HINT).toContain(
      `Up to ${CUSTOM_FIELD_MAX_FILES} files`,
    );
    expect(CUSTOM_FIELD_FILE_TYPES).not.toContain(MimeType.svg);
  });
});

describe("buildCustomFieldFormFields: a file field's input", () => {
  test("is a picker of the field's kind, and takes what the field takes", () => {
    const [file, files]: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [FILE_FIELD, FILES_FIELD],
    });

    expect(file!.fieldType).toBe(FormFieldSchemaType.File);
    expect(file!.fileTypes).toEqual([...CUSTOM_FIELD_FILE_TYPES]);
    expect(file!.placeholder).toBe(CUSTOM_FIELD_FILE_PLACEHOLDER);
    expect(files!.fieldType).toBe(FormFieldSchemaType.MultipleFiles);
    expect(files!.maxFiles).toBe(CUSTOM_FIELD_MAX_FILES);
  });

  test("is found by its field's name, as the record's card finds its files", () => {
    const [file, files]: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [FILE_FIELD, FILES_FIELD],
    });

    expect(file!.dataTestId).toBe(`custom-field-picker-${FILE_FIELD.name}`);
    expect(files!.dataTestId).toBe(`custom-field-picker-${FILES_FIELD.name}`);
  });

  test("a field of another kind is no picker", () => {
    const [text]: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [{ name: "Owner", customFieldType: CustomFieldType.Text }],
    });

    expect(text!.fileTypes).toBeUndefined();
    expect(text!.fileHint).toBeUndefined();
    expect(text!.dataTestId).toBeUndefined();
  });
});

describe("toCustomFieldFileFormValue: the record's files, as the picker lists them", () => {
  test("a File field's file is one File with its id, name and type", () => {
    const value: FileModel = toCustomFieldFileFormValue({
      customFieldType: CustomFieldType.File,
      value: CONTRACT,
    }) as FileModel;

    expect(value).toBeInstanceOf(FileModel);
    expect(value._id).toBe(CONTRACT.fileId);
    expect(value.name).toBe(CONTRACT.name);
    expect(value.fileType).toBe(CONTRACT.fileType);
  });

  test("a Multiple files field's files are a list, each once, in order", () => {
    const value: Array<FileModel> = toCustomFieldFileFormValue({
      customFieldType: CustomFieldType.MultipleFiles,
      value: [CONTRACT, PHOTO, CONTRACT],
    }) as Array<FileModel>;

    expect(
      value.map((file: FileModel): string => {
        return file._id!;
      }),
    ).toEqual([CONTRACT.fileId, PHOTO.fileId]);
  });

  test("no file is no File, and an empty list", () => {
    expect(
      toCustomFieldFileFormValue({
        customFieldType: CustomFieldType.File,
        value: "junk",
      }),
    ).toBeNull();
    expect(
      toCustomFieldFileFormValue({
        customFieldType: CustomFieldType.MultipleFiles,
        value: null,
      }),
    ).toEqual([]);
  });

  test("a field of another kind keeps its value as stored", () => {
    expect(
      toCustomFieldFileFormValue({
        customFieldType: CustomFieldType.Text,
        value: CONTRACT,
      }),
    ).toBe(CONTRACT);
  });
});

describe("fromCustomFieldFileFormValue: what the picker holds, as a write sends it", () => {
  test("a File field sends the one file it names", () => {
    expect(
      fromCustomFieldFileFormValue({
        customFieldType: CustomFieldType.File,
        value: [uploaded(CONTRACT)],
      }),
    ).toEqual({
      fileId: CONTRACT.fileId,
      name: CONTRACT.name,
      fileType: CONTRACT.fileType,
    });
  });

  test("a Multiple files field sends a list", () => {
    expect(
      fromCustomFieldFileFormValue({
        customFieldType: CustomFieldType.MultipleFiles,
        value: [uploaded(CONTRACT), uploaded(PHOTO)],
      }),
    ).toEqual([
      { fileId: CONTRACT.fileId, name: CONTRACT.name, fileType: MimeType.pdf },
      { fileId: PHOTO.fileId, name: PHOTO.name, fileType: MimeType.png },
    ]);
  });

  test("a file not yet stored - no id - is never sent", () => {
    const local: FileModel = new FileModel();
    local.name = "screenshot.png";
    local.fileType = MimeType.png;
    local.file = Buffer.from([1, 2, 3]);

    expect(
      fromCustomFieldFileFormValue({
        customFieldType: CustomFieldType.MultipleFiles,
        value: [local, uploaded(PHOTO)],
      }),
    ).toEqual([
      { fileId: PHOTO.fileId, name: PHOTO.name, fileType: MimeType.png },
    ]);
  });

  test("an empty picker is no file: null for a File field, an empty list for Multiple files", () => {
    for (const value of [undefined, null, "", []]) {
      expect(
        fromCustomFieldFileFormValue({
          customFieldType: CustomFieldType.File,
          value: value,
        }),
      ).toBeNull();
      expect(
        fromCustomFieldFileFormValue({
          customFieldType: CustomFieldType.MultipleFiles,
          value: value,
        }),
      ).toEqual([]);
    }
  });

  test("a stored value round-trips: the record's files go back as the files they are", () => {
    const sent: unknown = fromCustomFieldFileFormValue({
      customFieldType: CustomFieldType.MultipleFiles,
      value: toCustomFieldFileFormValue({
        customFieldType: CustomFieldType.MultipleFiles,
        value: [CONTRACT, PHOTO],
      }),
    });

    expect(sent).toEqual([
      { fileId: CONTRACT.fileId, name: CONTRACT.name, fileType: MimeType.pdf },
      { fileId: PHOTO.fileId, name: PHOTO.name, fileType: MimeType.png },
    ]);
  });

  test("a field of another kind keeps its value as given", () => {
    expect(
      fromCustomFieldFileFormValue({
        customFieldType: CustomFieldType.Text,
        value: "OPS-1",
      }),
    ).toBe("OPS-1");
  });
});

describe("a model form's file fields", () => {
  test("start from the files the template or record holds", () => {
    const values: JSONObject = getCustomFieldFormInitialValues({
      definitions: [FILE_FIELD, FILES_FIELD],
      customFields: { Contract: CONTRACT, Photos: [PHOTO] } as never,
    });

    expect(
      (values[getCustomFieldFormKey("Contract")] as unknown as FileModel)._id,
    ).toBe(CONTRACT.fileId);
    expect(
      (
        values[getCustomFieldFormKey("Photos")] as unknown as Array<FileModel>
      ).map((file: FileModel): string => {
        return file.name!;
      }),
    ).toEqual(["rack.png"]);
  });

  test("pack what the pickers hold as the files they name, and leave out an emptied one", () => {
    expect(
      packCustomFieldFormValues({
        definitions: [FILE_FIELD, FILES_FIELD],
        formValues: {
          [getCustomFieldFormKey("Contract")]: [uploaded(CONTRACT)] as never,
          [getCustomFieldFormKey("Photos")]: [] as never,
        },
        startingCustomFields: { Photos: [PHOTO] } as never,
      }),
    ).toEqual({
      Contract: {
        fileId: CONTRACT.fileId,
        name: CONTRACT.name,
        fileType: MimeType.pdf,
      },
    });
  });
});
