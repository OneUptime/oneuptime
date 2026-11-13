/*
 * Type-only on purpose: the one place the picker is loaded is the import()
 * below, so it, react-dropzone and file-selector stay out of the first load of
 * every page that draws a form.
 */
import type FilePicker from "./FilePicker";
import type { ComponentProps } from "./FilePicker";
import {
  FILE_PICKER_FILE_NAME_CLASS_NAME,
  FilePickerLayout,
  FilePickerPromptWords,
  getFilePickerLayout,
  getFilePickerPromptWords,
} from "./FilePickerLayout";
import FieldError from "../Forms/Fields/FieldError";
import IsolatedLine from "../IsolatedText/IsolatedLine";
import LazyControlPlaceholder from "../Forms/Fields/LazyControlPlaceholder";
import FileModel from "../../../Models/DatabaseModels/File";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "../../Utils/LazyLibrary";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The file picker as a form field draws it. Every page with a form reaches
 * FormField, and few forms take a file: the sign-in page's do not. So the
 * picker, with the about 73 KB of react-dropzone and file-selector it reads
 * drops through, is a file of its own, loaded by the first form that has one
 * (issue #5619), and until it arrives the field draws its place, the same size
 * (FilePickerPlaceholder).
 */
const filePicker: LazyLibrary<typeof FilePicker> = new LazyLibrary<
  typeof FilePicker
>(async (): Promise<typeof FilePicker> => {
  return (await import("./FilePicker")).default;
});

// Loads the picker, once however many ask; a failed load is retried.
export const loadFilePicker: () => Promise<typeof FilePicker> = (): Promise<
  typeof FilePicker
> => {
  return filePicker.load();
};

// The files the picker will hold when it arrives, as it reads them itself.
const getHeldFiles: (props: ComponentProps) => Array<FileModel> = (
  props: ComponentProps,
): Array<FileModel> => {
  if (props.value && props.value.length > 0) {
    return props.value;
  }

  if (Array.isArray(props.initialValue)) {
    return props.initialValue;
  }

  return props.initialValue instanceof FileModel ? [props.initialValue] : [];
};

export interface FilePickerPlaceholderProps extends ComponentProps {
  loadError: Error | null;
}

const BOX_CLASS_NAME: string = "animate-pulse rounded bg-gray-100";

/*
 * The picker's place, whichever way it will be drawn: a prompt to choose or
 * drop files, a smaller one over the files a picker of several holds, or the
 * file of a picker of one with no prompt at all. It says what the picker will
 * say, dimmed: the same words wrap the same way at any width, and nothing but
 * their colour changes when the picker arrives. The classes are the ones that
 * give FilePicker its size.
 */
export const FilePickerPlaceholder: FunctionComponent<
  FilePickerPlaceholderProps
> = (props: FilePickerPlaceholderProps): ReactElement => {
  const translator: Translator = useTranslator();

  const files: Array<FileModel> = getHeldFiles(props);

  const layout: FilePickerLayout = getFilePickerLayout({
    fileCount: files.length,
    isMultiFilePicker: props.isMultiFilePicker,
    maxFiles: props.maxFiles,
  });

  const promptWords: FilePickerPromptWords = getFilePickerPromptWords(
    translator,
    {
      placeholder: props.placeholder,
      isPlaceholderTranslated: props.isPlaceholderTranslated,
      hint: props.hint,
      mimeTypes: props.mimeTypes,
      maxFileSizeInBytes: props.maxFileSizeInBytes,
      keepFilesInBrowser: props.keepFilesInBrowser,
      isMultiFilePicker: props.isMultiFilePicker,
      hasFiles: files.length > 0,
    },
  );

  // Under the place while it is on its way, as the picker has it.
  const shownError: string | undefined = props.loadError
    ? undefined
    : props.error;

  return (
    <LazyControlPlaceholder
      dataTestId="file-picker-placeholder"
      loadError={props.loadError}
      fieldError={props.error}
      ariaLabelledby={props.ariaLabelledby}
      shape={
        <div className="space-y-4 w-full">
          {layout.isCollapsed && <div className="sr-only" />}

          {layout.isFull && (
            <div
              data-testid="file-picker-placeholder-zone"
              className="flex w-full justify-center rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
            >
              <div className="flex w-full flex-col items-center justify-center space-y-3 text-center">
                <p className="text-sm text-gray-400">
                  {translator.translateTemplate(
                    "This field holds up to {{count}} files. Remove one to add another.",
                    { count: layout.maxFiles || 0 },
                  )}
                </p>
              </div>
            </div>
          )}

          {layout.showsPrompt && (
            <div
              data-testid="file-picker-placeholder-zone"
              className={`flex w-full justify-center rounded-md border-2 border-dashed bg-white border-gray-300 ${
                layout.isCompactPrompt ? "px-4 py-4" : "px-6 py-8"
              }`}
            >
              <div className="flex w-full flex-col items-center justify-center space-y-3 text-center">
                <div className="sr-only" />
                <div className="flex flex-col items-center space-y-2">
                  {layout.isCompactPrompt ? (
                    <></>
                  ) : (
                    <div className={`h-12 w-12 ${BOX_CLASS_NAME}`} />
                  )}
                  <div className="flex flex-col items-center text-sm text-gray-400 space-y-1">
                    <span
                      className={`relative inline-flex items-center gap-1.5 font-medium ${
                        layout.isCompactPrompt ? "px-2 py-1" : "px-4 py-2"
                      }`}
                    >
                      {layout.isCompactPrompt ? (
                        <span className={`h-4 w-4 ${BOX_CLASS_NAME}`} />
                      ) : (
                        <></>
                      )}
                      <span>{promptWords.label}</span>
                    </span>
                    <p>{promptWords.instruction}</p>
                    <p className="text-xs">{promptWords.hint}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div className="space-y-2 w-full">
              {props.isMultiFilePicker ? (
                <div className={`h-5 w-24 ${BOX_CLASS_NAME}`} />
              ) : (
                <></>
              )}
              <div className="flex flex-col gap-2">
                {files.map((file: FileModel, index: number): ReactElement => {
                  return (
                    <div
                      key={file._id?.toString() || index}
                      data-testid="file-picker-placeholder-file"
                      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm"
                    >
                      <div className="flex min-w-0 flex-1 basis-48 items-start gap-3 text-left">
                        <div className={`h-9 w-9 shrink-0 ${BOX_CLASS_NAME}`} />
                        <div className="flex min-w-0 flex-col">
                          <IsolatedLine
                            as="p"
                            text={file.name || " "}
                            className={FILE_PICKER_FILE_NAME_CLASS_NAME}
                          />
                          <p className="text-xs">{" "}</p>
                        </div>
                      </div>
                      {/*
                       * Its buttons, out of sight: on a phone they take a
                       * line of their own under the name.
                       */}
                      <div
                        aria-hidden="true"
                        className="invisible ms-auto flex shrink-0 items-center gap-2"
                      >
                        {props.isMultiFilePicker || props.readOnly ? (
                          <></>
                        ) : (
                          <span className="rounded-md border px-3 py-1 text-xs font-medium">
                            {translator.translateText("Replace")}
                          </span>
                        )}
                        <span className="rounded-md border px-3 py-1 text-xs font-medium">
                          {translator.translateText("Remove")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {shownError && (
            <FieldError
              message={shownError}
              className="text-sm"
              announce="none"
            />
          )}
        </div>
      }
    />
  );
};

const LazyFilePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof FilePicker> = useLazyLibraryLoad(
    filePicker,
    true,
  );

  if (load.library) {
    const Picker: typeof FilePicker = load.library;

    return <Picker {...props} />;
  }

  return <FilePickerPlaceholder {...props} loadError={load.error} />;
};

export default LazyFilePicker;
