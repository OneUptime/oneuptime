import MimeType from "../../../Types/File/MimeType";
import { getMimeTypeLabel } from "../../../Types/File/MimeTypeLabel";
import { describe, expect, test } from "@jest/globals";

/*
 * A file's type as the file picker lists it under the file's name: the
 * short name people know a file by, never a MIME type that runs off a
 * phone's screen.
 */
describe("getMimeTypeLabel", () => {
  test("names a listed type by its MimeType key, in capitals", () => {
    expect(getMimeTypeLabel(MimeType.pdf)).toBe("PDF");
    expect(getMimeTypeLabel(MimeType.docx)).toBe("DOCX");
    expect(getMimeTypeLabel(MimeType.xlsx)).toBe("XLSX");
    expect(getMimeTypeLabel(MimeType.pptx)).toBe("PPTX");
    expect(getMimeTypeLabel(MimeType.odt)).toBe("ODT");
    expect(getMimeTypeLabel(MimeType.png)).toBe("PNG");
    expect(getMimeTypeLabel(MimeType.csv)).toBe("CSV");
    expect(getMimeTypeLabel(MimeType.pcap)).toBe("PCAP");
    expect(getMimeTypeLabel(MimeType.txt)).toBe("TXT");
    expect(getMimeTypeLabel(MimeType.md)).toBe("MD");
  });

  test("names a type two keys share by the first of them", () => {
    // jpg and jpeg are both image/jpeg.
    expect(MimeType.jpg).toBe(MimeType.jpeg);
    expect(getMimeTypeLabel("image/jpeg")).toBe("JPG");
  });

  test("reads a type in any case, with spaces around it", () => {
    expect(getMimeTypeLabel("  Application/PDF ")).toBe("PDF");
  });

  test("names a type MimeType does not list by the part after its slash", () => {
    expect(getMimeTypeLabel("audio/ogg")).toBe("OGG");
    expect(getMimeTypeLabel("plain")).toBe("PLAIN");
  });

  test("is empty for no type at all", () => {
    expect(getMimeTypeLabel("")).toBe("");
    expect(getMimeTypeLabel("   ")).toBe("");
    expect(getMimeTypeLabel(undefined)).toBe("");
    expect(getMimeTypeLabel(null)).toBe("");
    expect(getMimeTypeLabel(42)).toBe("");
  });

  test("every type the server stores has a label of at most five letters", () => {
    for (const type of Object.values(MimeType)) {
      const label: string = getMimeTypeLabel(type);

      expect({ type, label, short: label.length > 0 && label.length <= 5 }).toEqual({
        type,
        label,
        short: true,
      });
    }
  });
});
