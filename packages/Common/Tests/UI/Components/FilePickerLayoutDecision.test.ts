import {
  DEFAULT_MAX_FILE_SIZE_IN_BYTES,
  FILE_PICKER_FULL_NOTE,
  FilePickerLayout,
  FilePickerPromptData,
  FilePickerPromptWords,
  formatFileSizeLimit,
  getFilePickerLayout,
  getFilePickerPromptWords,
  getMaxFileSizeInBytes,
  isFilePickerCountHint,
  isPickerOfSeveralForOneFile,
} from "../../../UI/Components/FilePicker/FilePickerLayout";
import * as FilePicker from "../../../UI/Components/FilePicker/FilePicker";
import { CUSTOM_FIELD_FILES_HINT } from "../../../UI/Components/CustomFields/CustomFieldFormFields";
import {
  getGlobalTranslator,
  isOneFormOnlyForOne,
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import MimeType from "../../../Types/File/MimeType";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { describe, expect, test } from "@jest/globals";

/*
 * What a file picker shows for the files it holds, and the words it asks for
 * them with, read by the picker and by what draws in its place until its file
 * has arrived (LazyFilePicker): the same words wrap the same way.
 */

const layoutOf: (data: {
  fileCount: number;
  isMultiFilePicker?: boolean;
  maxFiles?: number;
}) => FilePickerLayout = (data: {
  fileCount: number;
  isMultiFilePicker?: boolean;
  maxFiles?: number;
}): FilePickerLayout => {
  return getFilePickerLayout({
    fileCount: data.fileCount,
    isMultiFilePicker: data.isMultiFilePicker,
    maxFiles: data.maxFiles,
  });
};

describe("a picker of one file", () => {
  test("empty, it shows the prompt in full", () => {
    expect(layoutOf({ fileCount: 0 })).toEqual({
      maxFiles: null,
      isFull: false,
      showsPrompt: true,
      isCollapsed: false,
      isCompactPrompt: false,
    });
  });

  test("holding its file, it shows the file alone", () => {
    expect(layoutOf({ fileCount: 1 })).toEqual({
      maxFiles: null,
      isFull: false,
      showsPrompt: false,
      isCollapsed: true,
      isCompactPrompt: false,
    });
  });

  test("takes no notice of a limit, which is for a picker of several", () => {
    expect(layoutOf({ fileCount: 1, maxFiles: 1 }).maxFiles).toBeNull();
    expect(layoutOf({ fileCount: 1, maxFiles: 1 }).isFull).toBe(false);
  });
});

describe("a picker of several files", () => {
  test("empty, it shows the prompt in full", () => {
    expect(layoutOf({ fileCount: 0, isMultiFilePicker: true })).toEqual({
      maxFiles: null,
      isFull: false,
      showsPrompt: true,
      isCollapsed: false,
      isCompactPrompt: false,
    });
  });

  test("holding files, it asks for more in a smaller prompt", () => {
    expect(layoutOf({ fileCount: 2, isMultiFilePicker: true })).toEqual({
      maxFiles: null,
      isFull: false,
      showsPrompt: true,
      isCollapsed: false,
      isCompactPrompt: true,
    });
  });

  test("holding as many as it may, it has no prompt and is not collapsed", () => {
    expect(
      layoutOf({ fileCount: 3, isMultiFilePicker: true, maxFiles: 3 }),
    ).toEqual({
      maxFiles: 3,
      isFull: true,
      showsPrompt: false,
      isCollapsed: false,
      isCompactPrompt: false,
    });
  });

  test("holding fewer than it may, it still asks for more", () => {
    const layout: FilePickerLayout = layoutOf({
      fileCount: 2,
      isMultiFilePicker: true,
      maxFiles: 3,
    });

    expect(layout.isFull).toBe(false);
    expect(layout.isCompactPrompt).toBe(true);
  });

  test("a limit that is not a whole positive number is rounded down, or none", () => {
    expect(
      layoutOf({ fileCount: 0, isMultiFilePicker: true, maxFiles: 2.9 })
        .maxFiles,
    ).toBe(2);

    for (const maxFiles of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        layoutOf({ fileCount: 5, isMultiFilePicker: true, maxFiles }).maxFiles,
      ).toBeNull();
    }
  });
});

describe("the prompt's words", () => {
  const wordsOf: (
    data: Partial<FilePickerPromptData>,
  ) => FilePickerPromptWords = (
    data: Partial<FilePickerPromptData>,
  ): FilePickerPromptWords => {
    return getFilePickerPromptWords(getGlobalTranslator(), {
      hasFiles: false,
      ...data,
    });
  };

  test("an empty picker of one asks for a file, up to the everyday limit", () => {
    expect(wordsOf({})).toEqual({
      label: "Upload files",
      instruction: "Click to choose a file or drag & drop.",
      hint: "Max 10 MB each.",
    });
  });

  test("an empty picker of several asks for files", () => {
    expect(wordsOf({ isMultiFilePicker: true }).instruction).toBe(
      "Click to choose files or drag & drop.",
    );
  });

  test("a picker holding files asks for more", () => {
    const words: FilePickerPromptWords = wordsOf({
      isMultiFilePicker: true,
      hasFiles: true,
    });

    expect(words.label).toBe("Add more files");
    expect(words.instruction).toBe("Click to add more or drag & drop.");
  });

  test("the words it is given win over its own", () => {
    const words: FilePickerPromptWords = wordsOf({
      placeholder: "Add your logo",
      hint: "PDF, pictures or ZIP, up to 10 MB.",
      mimeTypes: [MimeType.png],
    });

    expect(words.label).toBe("Add your logo");
    expect(words.hint).toBe("PDF, pictures or ZIP, up to 10 MB.");
  });

  test("it names the types it takes, each once", () => {
    expect(
      wordsOf({ mimeTypes: [MimeType.png, MimeType.jpg, MimeType.png] }).hint,
    ).toBe("Types: PNG, JPG. Max 10 MB each.");
  });

  test("it names its own limit when it has one", () => {
    expect(wordsOf({ maxFileSizeInBytes: 512 * 1024 }).hint).toBe(
      "Max 512 KB each.",
    );
    expect(
      wordsOf({ maxFileSizeInBytes: 512 * 1024, mimeTypes: [MimeType.png] })
        .hint,
    ).toBe("Types: PNG. Max 512 KB each.");
  });

  /*
   * A hint that names how many files the picker takes is a plural, said
   * with the picker's own most files - never a number written into its
   * words (issue #7421): a form question that takes three says three.
   */
  describe("a hint that names how many files it takes", () => {
    const COUNT_HINT: PluralTemplate = {
      one: "One file of up to {{size}}.",
      other: "Up to {{count}} files of {{size}} each.",
    };

    test.each([
      [10, "Up to 10 files of 10 MB each."],
      [3, "Up to 3 files of 10 MB each."],
      [2, "Up to 2 files of 10 MB each."],
      [1, "One file of up to 10 MB."],
    ])(
      "a picker of at most %p files says %p",
      (maxFiles: number, hint: string) => {
        expect(
          wordsOf({
            isMultiFilePicker: true,
            maxFiles: maxFiles,
            hint: COUNT_HINT,
            mimeTypes: [MimeType.png],
          }).hint,
        ).toBe(hint);
      },
    );

    test("its size is the picker's own limit, its count the picker's own most files", () => {
      expect(
        wordsOf({
          isMultiFilePicker: true,
          maxFiles: 4,
          maxFileSizeInBytes: 5 * 1024 * 1024,
          hint: COUNT_HINT,
        }).hint,
      ).toBe("Up to 4 files of 5 MB each.");
    });

    test("a picker with no most files has no count to say: its types and limit instead", () => {
      for (const maxFiles of [undefined, null, 0]) {
        expect(
          wordsOf({
            isMultiFilePicker: true,
            maxFiles: maxFiles,
            hint: COUNT_HINT,
            mimeTypes: [MimeType.png],
          }).hint,
        ).toBe("Types: PNG. Max 10 MB each.");
        expect(
          wordsOf({ isMultiFilePicker: true, maxFiles, hint: COUNT_HINT }).hint,
        ).toBe("Max 10 MB each.");
      }
    });

    test("a hint that is a sentence is said as it was, whatever the picker's most files", () => {
      expect(
        wordsOf({
          isMultiFilePicker: true,
          maxFiles: 3,
          hint: "PDF, pictures or ZIP, up to {{size}}.",
        }).hint,
      ).toBe("PDF, pictures or ZIP, up to 10 MB.");
    });

    test("only a plural is a count hint", () => {
      expect(isFilePickerCountHint(COUNT_HINT)).toBe(true);
      expect(isFilePickerCountHint("Up to {{size}}.")).toBe(false);
      expect(isFilePickerCountHint("")).toBe(false);
      expect(isFilePickerCountHint(undefined)).toBe(false);
    });

    test("the custom fields' hint names the picker's count, never a number of its own", () => {
      expect(CUSTOM_FIELD_FILES_HINT.other).toContain("{{count}}");
      expect(CUSTOM_FIELD_FILES_HINT.one).not.toContain("{{count}}");
      expect(
        `${CUSTOM_FIELD_FILES_HINT.one} ${CUSTOM_FIELD_FILES_HINT.other}`,
      ).not.toMatch(/[0-9]/);
      // Its one form says exactly one: Russian's 21 and French's 0 read the other.
      expect(isOneFormOnlyForOne(CUSTOM_FIELD_FILES_HINT)).toBe(true);
    });
  });

  /*
   * A picker of several that takes one file at most - a form question that
   * takes one file - asks for one file in every line of its prompt: never
   * "Upload files" and "Click to choose files" over "One file of up to
   * 10 MB" (issue #7421).
   */
  describe("a picker of several that takes one file", () => {
    test("is told apart from a picker of one and from one that takes more", () => {
      expect(
        isPickerOfSeveralForOneFile({ isMultiFilePicker: true, maxFiles: 1 }),
      ).toBe(true);

      for (const maxFiles of [2, 3, 10, null, undefined]) {
        expect(
          isPickerOfSeveralForOneFile({ isMultiFilePicker: true, maxFiles }),
        ).toBe(false);
      }

      // A picker of one is a picker of one: its words are its own.
      expect(
        isPickerOfSeveralForOneFile({ isMultiFilePicker: false, maxFiles: 1 }),
      ).toBe(false);
      expect(isPickerOfSeveralForOneFile({ maxFiles: 1 })).toBe(false);
    });

    test("asks for a file, in the words its hint says one file in", () => {
      expect(
        wordsOf({
          isMultiFilePicker: true,
          maxFiles: 1,
          hint: CUSTOM_FIELD_FILES_HINT,
        }),
      ).toEqual({
        label: "Upload a file",
        instruction: "Click to choose a file or drag & drop.",
        hint: "One file of up to 10 MB: PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP.",
      });
    });

    test("a picker of several that takes two or more still asks for files", () => {
      for (const maxFiles of [2, 3, 10]) {
        const words: FilePickerPromptWords = wordsOf({
          isMultiFilePicker: true,
          maxFiles,
          hint: CUSTOM_FIELD_FILES_HINT,
        });

        expect(words.label).toBe("Upload files");
        expect(words.instruction).toBe("Click to choose files or drag & drop.");
      }
    });

    test("the words it is given still win, and a file dragged over it says what letting go does", () => {
      expect(
        wordsOf({
          isMultiFilePicker: true,
          maxFiles: 1,
          placeholder: "Add the signed form",
        }).label,
      ).toBe("Add the signed form");
      expect(
        wordsOf({
          isMultiFilePicker: true,
          maxFiles: 1,
          isDragActive: true,
          keepFilesInBrowser: true,
        }).instruction,
      ).toBe("Release to add them.");
    });

    test("in German, Russian and Persian it asks for one file in the reader's words", () => {
      for (const language of ["de", "ru", "fa"]) {
        const translator: Translator = dashboardTranslator(language);
        const words: FilePickerPromptWords = getFilePickerPromptWords(
          translator,
          {
            isMultiFilePicker: true,
            maxFiles: 1,
            hint: CUSTOM_FIELD_FILES_HINT,
            hasFiles: false,
          },
        );

        expect(words.label).toBe(translator.translateText("Upload a file"));
        expect(words.label).not.toBe("Upload a file");
        expect(words.instruction).toBe(
          translator.translateText("Click to choose a file or drag & drop."),
        );
        expect(withoutIsolateMarks(words.hint || "")).toBe(
          withoutIsolateMarks(
            translator.translatePlural(CUSTOM_FIELD_FILES_HINT, 1, {
              size: formatFileSizeLimit(DEFAULT_MAX_FILE_SIZE_IN_BYTES, {
                language,
              }),
            }),
          ),
        );
      }
    });
  });

  test("a full picker says how many it holds, a picker of one in the words for one", () => {
    const translator: Translator = getGlobalTranslator();

    expect(translator.translatePlural(FILE_PICKER_FULL_NOTE, 3)).toBe(
      "This field holds up to 3 files. Remove one to add another.",
    );
    expect(translator.translatePlural(FILE_PICKER_FULL_NOTE, 1)).toBe(
      "This field holds one file. Remove it to add another.",
    );
    expect(isOneFormOnlyForOne(FILE_PICKER_FULL_NOTE)).toBe(true);
  });

  test("a file dragged over it says what letting go does", () => {
    expect(wordsOf({ isDragActive: true }).instruction).toBe(
      "Release to start uploading.",
    );
    expect(
      wordsOf({ isDragActive: true, keepFilesInBrowser: true }).instruction,
    ).toBe("Release to add them.");
  });
});

describe("the picker's size limit", () => {
  test("is read from the same place as the picker exports it", () => {
    expect(FilePicker.DEFAULT_MAX_FILE_SIZE_IN_BYTES).toBe(
      DEFAULT_MAX_FILE_SIZE_IN_BYTES,
    );
    expect(FilePicker.getMaxFileSizeInBytes).toBe(getMaxFileSizeInBytes);
    expect(FilePicker.formatFileSizeLimit).toBe(formatFileSizeLimit);
  });
});
