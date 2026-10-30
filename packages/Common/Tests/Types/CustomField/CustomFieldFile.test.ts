import {
  CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES,
  CUSTOM_FIELD_FILE_NAME_MAX_LENGTH,
  CUSTOM_FIELD_FILE_TYPES,
  CUSTOM_FIELD_FILES_MAX_TOTAL_SIZE_IN_BYTES,
  CUSTOM_FIELD_MAX_FILES,
  CustomFieldFile,
  CustomFieldFileReferences,
  formatCustomFieldFileNames,
  formatCustomFieldFileSize,
  getCustomFieldFileIds,
  getCustomFieldValueEntryKey,
  isCustomFieldFile,
  isCustomFieldFileMimeType,
  isCustomFieldFileType,
  readCustomFieldFileReference,
  readCustomFieldFileReferences,
  readCustomFieldFiles,
} from "../../../Types/CustomField/CustomFieldFile";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { hasFileContentRule } from "../../../Types/File/FileContentCheck";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A File or Multiple files custom field's value is a reference to an
 * uploaded file, never its bytes. What every reader must agree on: which
 * shapes of a write name a file, what a stored value holds, how it reads as
 * words, and what "the same file" means when a value is sent back.
 */

const ID_A: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const ID_B: string = "a3f2b1c0-d9e8-4f5a-8b7c-6d5e4f3a2b1c";
const ID_C: string = "b5c4d3e2-f1a0-4b5c-9d8e-7f6a5b4c3d2e";

const FILE_A: CustomFieldFile = {
  fileId: ID_A,
  name: "change-request.pdf",
  fileType: MimeType.pdf,
  size: 48213,
};

const FILE_B: CustomFieldFile = {
  fileId: ID_B,
  name: "rack-diagram.png",
  fileType: MimeType.png,
  size: 2048,
};

describe("the limits a file custom field keeps", () => {
  test("a file is at most 10 MB, as any upload is", () => {
    expect(CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES).toBe(10 * 1024 * 1024);
  });

  test("a Multiple files field holds at most 10 files and 50 MB", () => {
    expect(CUSTOM_FIELD_MAX_FILES).toBe(10);
    expect(CUSTOM_FIELD_FILES_MAX_TOTAL_SIZE_IN_BYTES).toBe(50 * 1024 * 1024);
  });

  test("a name fits File.name", () => {
    expect(CUSTOM_FIELD_FILE_NAME_MAX_LENGTH).toBe(ColumnLength.ShortText);
  });
});

describe("the kinds of file a field takes", () => {
  test("documents, spreadsheets, presentations, pictures, text, archives and captures", () => {
    for (const type of [
      MimeType.pdf,
      MimeType.docx,
      MimeType.xlsx,
      MimeType.pptx,
      MimeType.odt,
      MimeType.png,
      MimeType.jpeg,
      MimeType.txt,
      MimeType.csv,
      MimeType.json,
      MimeType.zip,
      MimeType.pcap,
    ]) {
      expect(isCustomFieldFileMimeType(type)).toBe(true);
    }
  });

  test("never SVG, which can carry script, nor an icon or audio", () => {
    expect(isCustomFieldFileMimeType(MimeType.svg)).toBe(false);
    expect(isCustomFieldFileMimeType(MimeType.ico)).toBe(false);
    expect(isCustomFieldFileMimeType(MimeType.aac)).toBe(false);
    expect(CUSTOM_FIELD_FILE_TYPES).not.toContain(MimeType.svg);
  });

  test("a type is read however it is cased or padded, and nothing else is one", () => {
    expect(isCustomFieldFileMimeType(" Application/PDF ")).toBe(true);
    expect(isCustomFieldFileMimeType("text/html")).toBe(false);
    expect(isCustomFieldFileMimeType("")).toBe(false);
    expect(isCustomFieldFileMimeType(undefined)).toBe(false);
    expect(isCustomFieldFileMimeType(42)).toBe(false);
  });

  test("every kind a field takes can be checked by what it holds", () => {
    /*
     * A kind with no content rule would be refused for every file
     * (FileContentCheck), so listing one here would be a kind nobody can
     * upload.
     */
    for (const type of CUSTOM_FIELD_FILE_TYPES) {
      expect(hasFileContentRule(type)).toBe(true);
    }
  });

  test("lists each kind once", () => {
    expect(new Set(CUSTOM_FIELD_FILE_TYPES).size).toBe(
      CUSTOM_FIELD_FILE_TYPES.length,
    );
  });
});

describe("isCustomFieldFileType", () => {
  test("is File and Multiple files only", () => {
    expect(isCustomFieldFileType(CustomFieldType.File)).toBe(true);
    expect(isCustomFieldFileType(CustomFieldType.MultipleFiles)).toBe(true);

    for (const type of Object.values(CustomFieldType)) {
      if (
        type !== CustomFieldType.File &&
        type !== CustomFieldType.MultipleFiles
      ) {
        expect(isCustomFieldFileType(type)).toBe(false);
      }
    }

    expect(isCustomFieldFileType(undefined)).toBe(false);
    expect(isCustomFieldFileType("file")).toBe(false);
  });
});

describe("readCustomFieldFileReference", () => {
  test("reads a file's id as text, in lower case", () => {
    expect(readCustomFieldFileReference(ID_A)).toBe(ID_A);
    expect(readCustomFieldFileReference(` ${ID_A.toUpperCase()} `)).toBe(ID_A);
  });

  test("reads { fileId }, an uploaded File's { _id } and { id }", () => {
    expect(readCustomFieldFileReference({ fileId: ID_A })).toBe(ID_A);
    expect(
      readCustomFieldFileReference({ _id: ID_B, name: "x.png", fileType: "" }),
    ).toBe(ID_B);
    expect(readCustomFieldFileReference({ id: ID_C })).toBe(ID_C);
    expect(readCustomFieldFileReference(FILE_A)).toBe(ID_A);
  });

  test("reads an ObjectID", () => {
    expect(readCustomFieldFileReference(new ObjectID(ID_A))).toBe(ID_A);
    expect(readCustomFieldFileReference({ _id: new ObjectID(ID_B) })).toBe(
      ID_B,
    );
  });

  test("prefers fileId over _id and id", () => {
    expect(
      readCustomFieldFileReference({ fileId: ID_A, _id: ID_B, id: ID_C }),
    ).toBe(ID_A);
  });

  test("falls back to the next key when one is not an id", () => {
    expect(readCustomFieldFileReference({ fileId: "nope", _id: ID_B })).toBe(
      ID_B,
    );
  });

  test("names no file for anything else", () => {
    for (const value of [
      "not-an-id",
      "",
      42,
      true,
      null,
      undefined,
      [ID_A],
      { name: "a.pdf" },
      { fileId: 7 },
      new Date(),
    ]) {
      expect(readCustomFieldFileReference(value)).toBeNull();
    }
  });
});

describe("readCustomFieldFileReferences", () => {
  test("reads a list's entries in order", () => {
    const references: CustomFieldFileReferences = readCustomFieldFileReferences(
      [ID_A, { fileId: ID_B }, { _id: ID_C }],
    );

    expect(references.fileIds).toEqual([ID_A, ID_B, ID_C]);
    expect(references.isList).toBe(true);
    expect(references.unreadableCount).toBe(0);
    expect(references.duplicateCount).toBe(0);
    expect(references.entryCount).toBe(3);
  });

  test("reads one value on its own as a list of one, and says it was not a list", () => {
    const references: CustomFieldFileReferences = readCustomFieldFileReferences(
      { fileId: ID_A },
    );

    expect(references.fileIds).toEqual([ID_A]);
    expect(references.isList).toBe(false);
    expect(references.entryCount).toBe(1);
  });

  test("counts what names no file and what names one twice", () => {
    const references: CustomFieldFileReferences = readCustomFieldFileReferences(
      [ID_A, "banana", { fileId: ID_A.toUpperCase() }, null],
    );

    expect(references.fileIds).toEqual([ID_A]);
    expect(references.unreadableCount).toBe(2);
    expect(references.duplicateCount).toBe(1);
    expect(references.entryCount).toBe(4);
  });

  test("an empty value names nothing", () => {
    for (const value of [undefined, null, "", []]) {
      expect(readCustomFieldFileReferences(value).fileIds).toEqual([]);
      expect(readCustomFieldFileReferences(value).entryCount).toBe(0);
    }
  });
});

describe("isCustomFieldFile and readCustomFieldFiles", () => {
  test("a stored reference has the file's id and its name", () => {
    expect(isCustomFieldFile(FILE_A)).toBe(true);
    expect(isCustomFieldFile({ fileId: ID_A, name: "" })).toBe(true);
    expect(isCustomFieldFile({ fileId: ID_A })).toBe(false);
    expect(isCustomFieldFile({ _id: ID_A, name: "a.pdf" })).toBe(false);
    expect(isCustomFieldFile(ID_A)).toBe(false);
    expect(isCustomFieldFile([FILE_A])).toBe(false);
  });

  test("reads one file, or a list of them, in order", () => {
    expect(readCustomFieldFiles(FILE_A)).toEqual([FILE_A]);
    expect(readCustomFieldFiles([FILE_B, FILE_A])).toEqual([FILE_B, FILE_A]);
  });

  test("leaves out what is not a file, and a file listed twice", () => {
    expect(
      readCustomFieldFiles([
        FILE_A,
        "text",
        { fileId: "x", name: "y" },
        FILE_A,
      ]),
    ).toEqual([FILE_A]);
  });

  test("reads the id in lower case, a blank name as the id, and a bad size as 0", () => {
    expect(
      readCustomFieldFiles({
        fileId: ID_A.toUpperCase(),
        name: "  ",
        size: -3,
      }),
    ).toEqual([{ fileId: ID_A, name: ID_A, fileType: "", size: 0 }]);

    expect(
      readCustomFieldFiles({ fileId: ID_B, name: "a", size: 10.7 })[0]!.size,
    ).toBe(10);

    expect(
      readCustomFieldFiles({ fileId: ID_B, name: "a", size: "10" })[0]!.size,
    ).toBe(0);
  });

  test("never throws, and reads nothing from what is no value", () => {
    for (const value of [undefined, null, "", 0, false, {}, [], new Date()]) {
      expect(readCustomFieldFiles(value)).toEqual([]);
    }
  });

  test("getCustomFieldFileIds lists the files' ids", () => {
    expect(getCustomFieldFileIds([FILE_A, FILE_B])).toEqual([ID_A, ID_B]);
    expect(getCustomFieldFileIds(null)).toEqual([]);
  });
});

describe("formatCustomFieldFileNames", () => {
  test("names the files, joined with commas", () => {
    expect(formatCustomFieldFileNames([FILE_A, FILE_B])).toBe(
      "change-request.pdf, rack-diagram.png",
    );
    expect(formatCustomFieldFileNames(FILE_B)).toBe("rack-diagram.png");
  });

  test("is empty for a value with no file, never the id or JSON", () => {
    expect(formatCustomFieldFileNames(undefined)).toBe("");
    expect(formatCustomFieldFileNames([])).toBe("");
    expect(formatCustomFieldFileNames(ID_A)).toBe("");
    expect(formatCustomFieldFileNames({ fileId: ID_A })).toBe("");
  });
});

describe("formatCustomFieldFileSize", () => {
  test("reads bytes, kilobytes and megabytes", () => {
    expect(formatCustomFieldFileSize(0)).toBe("0 B");
    expect(formatCustomFieldFileSize(640)).toBe("640 B");
    expect(formatCustomFieldFileSize(1024)).toBe("1 KB");
    expect(formatCustomFieldFileSize(48213)).toBe("47 KB");
    expect(formatCustomFieldFileSize(1024 * 1024)).toBe("1 MB");
    expect(formatCustomFieldFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatCustomFieldFileSize(10 * 1024 * 1024)).toBe("10 MB");
  });

  test("a size that is no size reads as nothing", () => {
    expect(formatCustomFieldFileSize(-1)).toBe("");
    expect(formatCustomFieldFileSize(Number.NaN)).toBe("");
    expect(formatCustomFieldFileSize(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("getCustomFieldValueEntryKey", () => {
  test("a file is the same file whichever shape names it", () => {
    const key: string = getCustomFieldValueEntryKey(FILE_A);

    expect(getCustomFieldValueEntryKey({ _id: ID_A, name: "renamed" })).toBe(
      key,
    );
    expect(getCustomFieldValueEntryKey({ id: ID_A.toUpperCase() })).toBe(key);
    expect(getCustomFieldValueEntryKey({ fileId: ID_A })).toBe(key);
  });

  test("two different files are two answers", () => {
    expect(getCustomFieldValueEntryKey(FILE_A)).not.toBe(
      getCustomFieldValueEntryKey(FILE_B),
    );
  });

  test("a scalar is its text, and another object its JSON", () => {
    expect(getCustomFieldValueEntryKey("East")).toBe("East");
    expect(getCustomFieldValueEntryKey(3)).toBe("3");
    expect(getCustomFieldValueEntryKey({ a: 1 })).toBe('{"a":1}');
  });

  test("an id given as text stays text: only an object names a file here", () => {
    /*
     * A multi-select may hold an option that happens to look like an id;
     * it must not be taken for a file and compared as one.
     */
    expect(getCustomFieldValueEntryKey(ID_A)).toBe(ID_A);
  });
});
