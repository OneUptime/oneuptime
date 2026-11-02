import { CUSTOM_FIELD_FILE_TYPES } from "../../../Types/CustomField/CustomFieldFile";
import { getFileTypeIcon } from "../../../Types/File/FileTypeIcon";
import MimeType from "../../../Types/File/MimeType";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, test } from "@jest/globals";

/*
 * The icon a file is listed with, by its kind. The Custom Fields card and
 * the file picker read it from one place, so a file is drawn the same in the
 * dialog that adds it and on the card that shows it: the picker drew every
 * file with one generic icon while the card told pictures, spreadsheets and
 * archives apart.
 */
describe("getFileTypeIcon", () => {
  test("a picture is a photo", () => {
    for (const type of [
      MimeType.png,
      MimeType.jpeg,
      MimeType.gif,
      MimeType.webp,
      MimeType.bmp,
      MimeType.tiff,
      MimeType.avif,
      MimeType.heic,
    ]) {
      expect(getFileTypeIcon(type)).toBe(IconProp.Photo);
    }
  });

  test("a spreadsheet is a table", () => {
    for (const type of [
      MimeType.csv,
      MimeType.xls,
      MimeType.xlsx,
      MimeType.ods,
    ]) {
      expect(getFileTypeIcon(type)).toBe(IconProp.TableCells);
    }
  });

  test("an archive - a packet capture among them - is an archive", () => {
    expect(getFileTypeIcon(MimeType.zip)).toBe(IconProp.Archive);
    expect(getFileTypeIcon(MimeType.pcap)).toBe(IconProp.Archive);
  });

  test("any other document is a page of text", () => {
    for (const type of [
      MimeType.pdf,
      MimeType.docx,
      MimeType.txt,
      MimeType.md,
      MimeType.json,
      "application/x-unknown",
    ]) {
      expect(getFileTypeIcon(type)).toBe(IconProp.DocumentText);
    }
  });

  test("reads a type in any case, with spaces around it", () => {
    expect(getFileTypeIcon("  IMAGE/PNG ")).toBe(IconProp.Photo);
    expect(getFileTypeIcon("Text/CSV")).toBe(IconProp.TableCells);
  });

  test("no type, or no text at all, is a document", () => {
    for (const value of ["", undefined, null, 7, {}]) {
      expect(getFileTypeIcon(value)).toBe(IconProp.DocumentText);
    }
  });

  test("every kind a file field takes has an icon of its kind", () => {
    const icons: Set<IconProp> = new Set<IconProp>();

    for (const type of CUSTOM_FIELD_FILE_TYPES) {
      icons.add(getFileTypeIcon(type));
    }

    expect(Array.from(icons).sort()).toEqual(
      [
        IconProp.Archive,
        IconProp.DocumentText,
        IconProp.Photo,
        IconProp.TableCells,
      ].sort(),
    );
  });
});
