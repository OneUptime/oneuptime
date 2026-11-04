import MimeType from "../../../Types/File/MimeType";
import { Translator } from "../../Utils/TranslateTemplate";

/*
 * What a file picker shows for the files it holds, and the words it asks for
 * them with: read by the picker, and by what draws in its place until the
 * picker's file has arrived (LazyFilePicker), so the two take the same room
 * at any width.
 */

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

type FormatFileSizeLimitFunction = (bytes: number) => string;

// A limit as people read it: "512 KB", "1 MB", "1.5 MB".
export const formatFileSizeLimit: FormatFileSizeLimitFunction = (
  bytes: number,
): string => {
  const megabytes: number = bytes / (1024 * 1024);

  if (megabytes >= 1) {
    return `${Math.round(megabytes * 10) / 10} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
  const maxFileSize: string = formatFileSizeLimit(maxFileSizeBytes);
  // The everyday limit keeps its own wording (and its translations).
  const hasOwnLimit: boolean =
    maxFileSizeBytes !== DEFAULT_MAX_FILE_SIZE_IN_BYTES;

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
    label: translator.translateText(
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
    hint: data.hint
      ? translator.translateText(data.hint)
      : data.mimeTypes && data.mimeTypes.length > 0
        ? translator.translateTemplate(
            hasOwnLimit
              ? "Types: {{types}}. Max {{size}} each."
              : "Types: {{types}}. Max 10MB each.",
            {
              size: maxFileSize,
              types: typeNames(),
            },
          )
        : hasOwnLimit
          ? translator.translateTemplate("Max {{size}} each.", {
              size: maxFileSize,
            })
          : translator.translateText("Max 10MB each."),
  };
};
