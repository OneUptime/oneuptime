import { formatCustomFieldFileSize } from "../../../Types/CustomField/CustomFieldFile";
import { formatFileSize } from "../../../Types/File/FileSize";
import { describe, expect, test } from "@jest/globals";

/*
 * A file's size as every list of files says it - the Custom Fields card,
 * the file picker a form lists files in, a form's review step and a
 * submission's answers: whole kilobytes under a megabyte, one decimal from
 * a megabyte on, bytes under a kilobyte. The picker used to say "47.1 KB"
 * where the card said "47 KB", and "0.1 KB" for a 100-byte file.
 */
describe("formatFileSize", () => {
  test("a file under a kilobyte is counted in bytes, never 0.1 KB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(66)).toBe("66 B");
    expect(formatFileSize(100)).toBe("100 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  test("whole kilobytes under a megabyte, never a decimal", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(48213)).toBe("47 KB");
    expect(formatFileSize(245760)).toBe("240 KB");
    // Just under a megabyte rounds to the kilobyte, not to "1 MB".
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024 KB");
  });

  test("one decimal from a megabyte on, none when it is whole", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileSize(2516582)).toBe("2.4 MB");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10 MB");
  });

  test("a fraction of a byte is a whole byte down", () => {
    expect(formatFileSize(640.9)).toBe("640 B");
  });

  test("no size to say for what is not one", () => {
    expect(formatFileSize(-1)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("");
  });

  test("a file custom field says its files' sizes the same way", () => {
    for (const bytes of [0, 66, 1024, 48213, 2516582, 10 * 1024 * 1024, -1]) {
      expect(formatCustomFieldFileSize(bytes)).toBe(formatFileSize(bytes));
    }
  });
});
