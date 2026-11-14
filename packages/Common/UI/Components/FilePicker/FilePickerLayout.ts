import MimeType from "../../../Types/File/MimeType";
import { FileSizeOptions, formatFileSize } from "../../../Types/File/FileSize";
import { Translator } from "../../Utils/TranslateTemplate";

/*
 * What a file picker shows for the files it holds, and the words it asks for
 * them with: read by the picker, and by what draws in its place until the
 * picker's file has arrived (LazyFilePicker), so the two take the same room
 * at any width.
 */

/*
 * A picked file's name: the whole of it, wrapped where it has to be. Drawn
 * as a line of its own (IsolatedLine) by the picker and by what draws in its
 * place until it has arrived, so both take the same room.
 */
export const FILE_PICKER_FILE_NAME_CLASS_NAME: string =
  "break-words text-sm font-medium text-gray-900 [overflow-wrap:anywhere]";

// What any upload may be, unless the picker is given less.
export const DEFAULT_MAX_FILE_SIZE_IN_BYTES: number = 10 * 1024 * 1024;

type GetMaxFileSizeInBytesFunction = (value: number | undefined) => number;

// The picker's limit: its own when it is a smaller positive number.
export const getMaxFileSizeInBytes: GetMaxFileSizeInBytesFunction = (
  value: number | undefined,
): number => {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value < DEFAULT_MAX_FILE_SIZE_IN_BYTES
    ? value
    : DEFAULT_MAX_FILE_SIZE_IN_BYTES;
};

type FormatFileSizeLimitFunction = (
  bytes: number,
  options?: FileSizeOptions,
) => string;

/*
 * A limit as people read it: "512 KB", "1 MB", "1.5 MB" - in the reader's
 * digits, as every file's size is (Types/File/FileSize): "۱۰ MB" on a
 * Persian page. Never in bytes: a limit under a kilobyte reads "1 KB".
 */
export const formatFileSizeLimit: FormatFileSizeLimitFunction = (
  bytes: number,
  options?: FileSizeOptions,
): string => {
  return formatFileSize(Math.max(bytes, 1024), options);
};

export interface FilePickerLayout {
  // The most files a picker of several holds; none for no limit.
  maxFiles: number | null;
  // A picker of several that holds as many as it may.
  isFull: boolean;
  // The prompt to choose or drop files: an empty picker, or one of several.
  showsPrompt: boolean;
  /*
   * A picker of one that holds its file shows the file alone: no empty drop
   * zone above it. Its file chooser stays in the page, out of sight, for
   * Replace to open - react-dropzone's open() clicks the input, and does
   * nothing when there is none.
   */
  isCollapsed: boolean;
  /*
   * A picker of several that already lists files asks for more in a smaller
   * zone: the files are what the reader came to see, and a second
   * illustration the height of the dialog pushed them out of sight.
   */
  isCompactPrompt: boolean;
}

export const getFilePickerLayout: (data: {
  fileCount: number;
  isMultiFilePicker: boolean | undefined;
  maxFiles: number | undefined;
}) => FilePickerLayout = (data: {
  fileCount: number;
  isMultiFilePicker: boolean | undefined;
  maxFiles: number | undefined;
}): FilePickerLayout => {
  const maxFiles: number | null =
    data.isMultiFilePicker &&
    typeof data.maxFiles === "number" &&
    Number.isFinite(data.maxFiles) &&
    data.maxFiles > 0
      ? Math.floor(data.maxFiles)
      : null;

  const isFull: boolean = maxFiles !== null && data.fileCount >= maxFiles;

  const showsPrompt: boolean =
    !isFull && (data.fileCount === 0 || Boolean(data.isMultiFilePicker));

  return {
    maxFiles: maxFiles,
    isFull: isFull,
    showsPrompt: showsPrompt,
    isCollapsed: !isFull && !showsPrompt,
    isCompactPrompt: showsPrompt && data.fileCount > 0,
  };
};

export interface FilePickerPromptData {
  placeholder?: string | undefined;
  // In the reader's words already: said as given (Field's, #7682).
  isPlaceholderTranslated?: boolean | undefined;
  hint?: string | undefined;
  mimeTypes?: Array<MimeType> | undefined;
  maxFileSizeInBytes?: number | undefined;
  keepFilesInBrowser?: boolean | undefined;
  isMultiFilePicker?: boolean | undefined;
  hasFiles: boolean;
  isDragActive?: boolean | undefined;
}

export interface FilePickerPromptWords {
  // What to press.
  label: string | undefined;
  // How to choose a file, or what letting go of one does.
  instruction: string | undefined;
  // What it takes.
  hint: string | undefined;
}

// The three lines of the prompt to choose or drop files.
export const getFilePickerPromptWords: (
  translator: Translator,
  data: FilePickerPromptData,
) => FilePickerPromptWords = (
  translator: Translator,
  data: FilePickerPromptData,
): FilePickerPromptWords => {
  const maxFileSizeBytes: number = getMaxFileSizeInBytes(
    data.maxFileSizeInBytes,
  );
  const maxFileSize: string = formatFileSizeLimit(maxFileSizeBytes, {
    language: translator.language,
  });

  const typeNames: () => string = (): string => {
    return (data.mimeTypes || [])
      .map((type: MimeType) => {
        const enumKey: string | undefined =
          Object.keys(MimeType)[Object.values(MimeType).indexOf(type)];
        return enumKey?.toUpperCase() || "";
      })
      .filter(
        (
          item: string | undefined,
          pos: number,
          array: Array<string | undefined>,
        ) => {
          return array.indexOf(item) === pos;
        },
      )
      .join(", ");
  };

  return {
    label:
      data.placeholder && data.isPlaceholderTranslated
        ? data.placeholder
        : translator.translateText(
            data.placeholder
              ? data.placeholder
              : data.hasFiles
                ? "Add more files"
                : "Upload files",
          ),
    instruction: translator.translateText(
      data.isDragActive
        ? data.keepFilesInBrowser
          ? "Release to add them."
          : "Release to start uploading."
        : data.hasFiles
          ? "Click to add more or drag & drop."
          : // A picker of one takes one file.
            data.isMultiFilePicker
            ? "Click to choose files or drag & drop."
            : "Click to choose a file or drag & drop.",
    ),
    /*
     * Every limit, the everyday 10 MB too, is one value of its sentence:
     * written in the reader's digits and set apart from the words around
     * it, so a page read from the right draws "۱۰ MB", never "MB 10" - as
     * a limit written into the words ("Max 10MB each.") was drawn on Arabic
     * and Persian pages (issue #7233). Drawn on the page only, so its
     * isolate marks never reach a record. A hint the picker is given (a
     * custom field's "... up to {{size}}.") names the same limit: its
     * {{size}} is this picker's.
     */
    hint: data.hint
      ? translator.translateTemplate(
          data.hint,
          { size: maxFileSize },
          { setsValuesApart: true },
        )
      : data.mimeTypes && data.mimeTypes.length > 0
        ? translator.translateTemplate(
            "Types: {{types}}. Max {{size}} each.",
            {
              size: maxFileSize,
              types: typeNames(),
            },
            { setsValuesApart: true },
          )
        : translator.translateTemplate(
            "Max {{size}} each.",
            { size: maxFileSize },
            { setsValuesApart: true },
          ),
  };
};
