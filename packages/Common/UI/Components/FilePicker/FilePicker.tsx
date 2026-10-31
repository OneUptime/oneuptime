import { FILE_URL } from "../../Config";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Icon from "../Icon/Icon";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import CommonURL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import MimeType from "../../../Types/File/MimeType";
import { formatFileSize as formatBytes } from "../../../Types/File/FileSize";
import { getFileTypeIcon } from "../../../Types/File/FileTypeIcon";
import { getMimeTypeLabel } from "../../../Types/File/MimeTypeLabel";
import IconProp from "../../../Types/Icon/IconProp";
import { getKnownFileSize, rememberFileSize } from "./KnownFileSizes";
import FileModel from "../../../Models/DatabaseModels/File";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { useDropzone, type FileRejection } from "react-dropzone";
import type { AxiosProgressEvent } from "axios";

export interface ComponentProps {
  initialValue?: undefined | Array<FileModel> | FileModel;
  onClick?: undefined | (() => void);
  placeholder?: undefined | string;
  className?: undefined | string;
  onChange?: undefined | ((value: Array<FileModel>) => void);
  value?: Array<FileModel> | undefined;
  readOnly?: boolean | undefined;
  mimeTypes?: Array<MimeType> | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  isMultiFilePicker?: boolean | undefined;
  tabIndex?: number | undefined;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  // What describes the upload: its field's help.
  ariaDescribedby?: string | undefined;
  /*
   * The largest file this picker takes, in bytes, when it is less than the
   * 10 MB every upload is held to - a form's logo takes 512 KB. A larger
   * file is refused here, before it is uploaded, and the hint under the
   * picker says the same limit, so the picker never promises more than the
   * field will keep.
   */
  maxFileSizeInBytes?: number | undefined;
  /*
   * A picker of several files: the most it holds. It takes no more - a drop
   * of more than there is room for adds what fits and says so - and once it
   * is full it says how to add another.
   */
  maxFiles?: number | undefined;
  /*
   * What the picker says it takes, in place of the list of its types: for a
   * picker that takes many kinds of file, whose list would run to a
   * paragraph ("PDF, Office files, pictures, text, ZIP or PCAP, up to
   * 10 MB.").
   */
  hint?: string | undefined;
  /*
   * Keep the files in the browser rather than uploading them: each one the
   * picker hands back holds its bytes and no id. For a page nobody is signed
   * in to upload as - a public form, which sends the files with its answers.
   */
  keepFilesInBrowser?: boolean | undefined;
}

type UploadStatus = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "error";
  errorMessage?: string | undefined;
};

type AddUploadStatusFunction = (status: UploadStatus) => void;
type UpdateUploadStatusFunction = (
  id: string,
  updates: Partial<UploadStatus>,
) => void;
type UpdateUploadProgressFunction = (
  id: string,
  total?: number,
  loaded?: number,
) => void;
type RemoveUploadStatusFunction = (id: string) => void;
type BuildFileSizeErrorFunction = (fileNames: Array<string>) => string;
type BuildFileTypeErrorFunction = (fileNames: Array<string>) => string;
type ResolveMimeTypeFunction = (file: File) => MimeType | undefined;
type FormatFileSizeFunction = (file: FileModel) => string | null;

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

/*
 * The other name browsers give an ICO file ("image/vnd.microsoft.icon", on
 * Linux and in Firefox), for a picker that takes ICO: it is accepted, by
 * its extension too, and stored as MimeType.ico.
 */
const ICO_ALIAS_MIME_TYPE: string = "image/vnd.microsoft.icon";

const FilePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [filesModel, setFilesModel] = useState<Array<FileModel>>([]);

  const [acceptTypes, setAcceptTypes] = useState<Dictionary<Array<string>>>({});
  const [uploadStatuses, setUploadStatuses] = useState<Array<UploadStatus>>([]);
  // One page can hold several pickers: each input has an id of its own.
  const inputId: string = useId();

  // The most files a picker of several holds; none for no limit.
  const maxFiles: number | null =
    props.isMultiFilePicker &&
    typeof props.maxFiles === "number" &&
    Number.isFinite(props.maxFiles) &&
    props.maxFiles > 0
      ? Math.floor(props.maxFiles)
      : null;

  const maxFileSizeBytes: number = getMaxFileSizeInBytes(
    props.maxFileSizeInBytes,
  );
  const maxFileSize: string = formatFileSizeLimit(maxFileSizeBytes);
  // The everyday limit keeps its own wording (and its translations).
  const hasOwnLimit: boolean =
    maxFileSizeBytes !== DEFAULT_MAX_FILE_SIZE_IN_BYTES;

  const addUploadStatus: AddUploadStatusFunction = (
    status: UploadStatus,
  ): void => {
    setUploadStatuses((current: Array<UploadStatus>) => {
      return [...current, status];
    });
  };

  const updateUploadStatus: UpdateUploadStatusFunction = (
    id: string,
    updates: Partial<UploadStatus>,
  ): void => {
    setUploadStatuses((current: Array<UploadStatus>) => {
      return current.map((upload: UploadStatus) => {
        return upload.id === id
          ? {
              ...upload,
              ...updates,
            }
          : upload;
      });
    });
  };

  const updateUploadProgress: UpdateUploadProgressFunction = (
    id: string,
    total?: number,
    loaded?: number,
  ): void => {
    setUploadStatuses((current: Array<UploadStatus>) => {
      return current.map((upload: UploadStatus) => {
        if (upload.id !== id || upload.status === "error") {
          return upload;
        }

        const hasTotal: boolean = Boolean(total && total > 0);
        const progressFromEvent: number | null = hasTotal
          ? Math.min(100, Math.round(((loaded || 0) / (total as number)) * 100))
          : null;
        const fallbackProgress: number = Math.min(upload.progress + 5, 95);

        return {
          ...upload,
          progress:
            progressFromEvent !== null ? progressFromEvent : fallbackProgress,
        };
      });
    });
  };

  const removeUploadStatus: RemoveUploadStatusFunction = (id: string): void => {
    setUploadStatuses((current: Array<UploadStatus>) => {
      return current.filter((upload: UploadStatus) => {
        return upload.id !== id;
      });
    });
  };

  useEffect(() => {
    const _acceptTypes: Dictionary<Array<string>> = {};
    if (props.mimeTypes) {
      for (const key of props.mimeTypes) {
        _acceptTypes[key] = [];

        if (key === MimeType.ico) {
          _acceptTypes[key] = [".ico"];
          _acceptTypes[ICO_ALIAS_MIME_TYPE] = [".ico"];
        }
      }
    }
    setAcceptTypes(_acceptTypes);
  }, [props.mimeTypes]);

  useEffect(() => {
    setInitialValue();
  }, [props.initialValue]);

  const setInitialValue: VoidFunction = () => {
    if (
      Array.isArray(props.initialValue) &&
      props.initialValue &&
      props.initialValue.length > 0
    ) {
      setFilesModel(props.initialValue);
    } else if (props.initialValue instanceof FileModel) {
      setFilesModel([props.initialValue as FileModel]);
    }
  };

  useEffect(() => {
    if (props.value && props.value.length > 0) {
      setFilesModel(props.value && props.value.length > 0 ? props.value : []);
    } else {
      setInitialValue();
    }
  }, [props.value]);

  const buildFileSizeError: BuildFileSizeErrorFunction = (
    fileNames: Array<string>,
  ): string => {
    if (fileNames.length === 0) {
      return "";
    }

    if (hasOwnLimit) {
      if (fileNames.length === 1) {
        return translator.translateTemplate(
          '"{{fileName}}" exceeds the {{size}} limit.',
          { fileName: fileNames[0] || "", size: maxFileSize },
        );
      }

      return translator.translateTemplate(
        "These files exceed the {{size}} limit: {{fileNames}}.",
        { fileNames: fileNames.join(", "), size: maxFileSize },
      );
    }

    if (fileNames.length === 1) {
      return translator.translateTemplate(
        '"{{fileName}}" exceeds the 10MB limit.',
        { fileName: fileNames[0] || "" },
      );
    }

    return translator.translateTemplate(
      "These files exceed the 10MB limit: {{fileNames}}.",
      { fileNames: fileNames.join(", ") },
    );
  };

  const buildFileTypeError: BuildFileTypeErrorFunction = (
    fileNames: Array<string>,
  ): string => {
    if (fileNames.length === 1) {
      return translator.translateTemplate(
        '"{{fileName}}" is not a type of file this field takes.',
        { fileName: fileNames[0] || "" },
      );
    }

    return translator.translateTemplate(
      "These files are not a type this field takes: {{fileNames}}.",
      { fileNames: fileNames.join(", ") },
    );
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: acceptTypes,
    multiple: props.isMultiFilePicker,
    noClick: true,
    disabled: props.readOnly || isLoading,
    maxSize: maxFileSizeBytes,
    onDropRejected: (fileRejections: Array<FileRejection>) => {
      const oversizedFiles: Array<string> = fileRejections
        .filter((rejection: FileRejection) => {
          return rejection.file.size > maxFileSizeBytes;
        })
        .map((rejection: FileRejection) => {
          return rejection.file.name;
        });

      if (oversizedFiles.length > 0) {
        setError(buildFileSizeError(oversizedFiles));
        return;
      }

      /*
       * A file of a type the picker does not take is refused by the
       * browser's picker and by the drop alike: say so, rather than drop it
       * without a word.
       */
      const refusedTypes: Array<string> = fileRejections
        .filter((rejection: FileRejection) => {
          return rejection.errors.some((error: { code: string }) => {
            return error.code === "file-invalid-type";
          });
        })
        .map((rejection: FileRejection) => {
          return rejection.file.name;
        });

      if (refusedTypes.length > 0) {
        setError(buildFileTypeError(refusedTypes));
        return;
      }

      // Several files dropped on a picker of one.
      if (
        fileRejections.some((rejection: FileRejection) => {
          return rejection.errors.some((error: { code: string }) => {
            return error.code === "too-many-files";
          });
        })
      ) {
        setError(translator.translateText("Add one file at a time.") || "");
      }
    },
    onDrop: async (acceptedFiles: Array<File>) => {
      if (props.readOnly) {
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        // Upload these files.
        const filesResult: Array<FileModel> = [];
        const resolveMimeType: ResolveMimeTypeFunction = (
          file: File,
        ): MimeType | undefined => {
          const direct: string | undefined = file.type || undefined;
          if (direct && Object.values(MimeType).includes(direct as MimeType)) {
            return direct as MimeType;
          }

          if (direct === ICO_ALIAS_MIME_TYPE) {
            return MimeType.ico;
          }

          // fallback based on extension
          const ext: string | undefined = file.name
            .split(".")
            .pop()
            ?.toLowerCase();
          if (!ext) {
            return undefined;
          }
          const map: { [key: string]: MimeType } = {
            png: MimeType.png,
            jpg: MimeType.jpg,
            jpeg: MimeType.jpeg,
            svg: MimeType.svg,
            gif: MimeType.gif,
            webp: MimeType.webp,
            ico: MimeType.ico,
            pdf: MimeType.pdf,
            doc: MimeType.doc,
            docx: MimeType.docx,
            txt: MimeType.txt,
            log: MimeType.txt,
            md: MimeType.md,
            markdown: MimeType.md,
            csv: MimeType.csv,
            json: MimeType.json,
            zip: MimeType.zip,
            rtf: MimeType.rtf,
            odt: MimeType.odt,
            xls: MimeType.xls,
            xlsx: MimeType.xlsx,
            ods: MimeType.ods,
            ppt: MimeType.ppt,
            pptx: MimeType.pptx,
            odp: MimeType.odp,
          };
          return map[ext];
        };

        const oversizedFiles: Array<string> = [];

        /*
         * What room a picker of several files has left. A drop of more than
         * fits adds what fits, and the picker - full - says how many it holds.
         */
        const room: number | null =
          maxFiles === null ? null : Math.max(0, maxFiles - filesModel.length);
        const filesToAdd: Array<File> =
          room === null ? acceptedFiles : acceptedFiles.slice(0, room);

        for (const acceptedFile of filesToAdd) {
          if (acceptedFile.size > maxFileSizeBytes) {
            oversizedFiles.push(acceptedFile.name);
            continue;
          }

          /*
           * Kept in the browser: the file with its bytes, and no id, for the
           * page to send with what it submits.
           */
          if (props.keepFilesInBrowser) {
            const localFile: FileModel = new FileModel();
            localFile.name = acceptedFile.name;
            localFile.fileType = resolveMimeType(acceptedFile) || MimeType.txt;
            localFile.file = Buffer.from(
              new Uint8Array(await acceptedFile.arrayBuffer()),
            );
            filesResult.push(localFile);
            continue;
          }

          const uploadId: string = `${acceptedFile.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          addUploadStatus({
            id: uploadId,
            name: acceptedFile.name,
            progress: 0,
            status: "uploading",
          });

          try {
            const fileModel: FileModel = new FileModel();
            fileModel.name = acceptedFile.name;
            const arrayBuffer: ArrayBuffer = await acceptedFile.arrayBuffer();
            const fileBuffer: Uint8Array = new Uint8Array(arrayBuffer);
            fileModel.file = Buffer.from(fileBuffer);
            fileModel.fileType = resolveMimeType(acceptedFile) || MimeType.txt; // default to text/plain to satisfy required field

            const result: HTTPResponse<FileModel> =
              (await ModelAPI.create<FileModel>({
                model: fileModel,
                modelType: FileModel,
                requestOptions: {
                  overrideRequestUrl: CommonURL.fromURL(FILE_URL),
                  apiRequestOptions: {
                    onUploadProgress: (progressEvent: AxiosProgressEvent) => {
                      updateUploadProgress(
                        uploadId,
                        progressEvent.total,
                        progressEvent.loaded,
                      );
                    },
                  },
                },
              })) as HTTPResponse<FileModel>;
            filesResult.push(result.data as FileModel);
            // Its size, for when the form hands it back without its bytes.
            rememberFileSize(result.data?._id, acceptedFile.size);
            removeUploadStatus(uploadId);
          } catch (uploadErr) {
            /*
             * Said once, in the upload's own row beside the file it is
             * about: the prompt said it too, so the same sentence was on
             * screen twice.
             */
            updateUploadStatus(uploadId, {
              status: "error",
              errorMessage: API.getFriendlyMessage(uploadErr),
              progress: 100,
            });
          }
        }

        if (oversizedFiles.length > 0) {
          setError(buildFileSizeError(oversizedFiles));
        }

        if (filesResult.length > 0) {
          const updatedFiles: Array<FileModel> = props.isMultiFilePicker
            ? [...filesModel, ...filesResult]
            : filesResult;

          setFilesModel(updatedFiles);

          props.onBlur?.();
          props.onChange?.(updatedFiles);
        }
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    },
  });

  type GetThumbsFunction = () => Array<ReactElement>;

  /*
   * "47 KB", as the Custom Fields card says it (Types/File/FileSize): from
   * the bytes the picker holds or - for a stored file, which comes without
   * them - from what the page was told of it (KnownFileSizes).
   */
  const formatFileSize: FormatFileSizeFunction = (
    file: FileModel,
  ): string | null => {
    const bytes: number | null = file.file
      ? file.file.byteLength
      : getKnownFileSize(file._id);

    if (bytes === null) {
      return null;
    }

    return formatBytes(bytes) || null;
  };

  const getThumbs: GetThumbsFunction = (): Array<ReactElement> => {
    return filesModel.map((file: FileModel, i: number) => {
      const key: string = file._id?.toString() || `${file.name || "file"}-${i}`;
      const removeFile: VoidFunction = (): void => {
        const tempFileModel: Array<FileModel> = [...filesModel];
        tempFileModel.splice(i, 1);
        setFilesModel(tempFileModel);
        props.onChange?.(tempFileModel);
      };

      const metadata: Array<string> = [];
      /*
       * "PDF", not application/pdf: a Word document's MIME type is a word of
       * 71 letters that would run off a phone's screen.
       */
      const typeLabel: string = getMimeTypeLabel(file.fileType);
      if (typeLabel) {
        metadata.push(typeLabel);
      }
      const readableSize: string | null = formatFileSize(file);
      if (readableSize) {
        metadata.push(readableSize);
      }

      return (
        <div
          key={key}
          className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm"
          data-testid="file-picker-file"
        >
          {/*
           * A long name wraps in its row rather than push its buttons off;
           * where the row is too narrow for both - a phone - the buttons
           * move under the name, which keeps the row's width.
           */}
          <div className="flex min-w-0 flex-1 basis-48 items-start gap-3 text-left">
            {/*
             * The kind of file it is - a picture, a spreadsheet, an archive
             * or a document - drawn as the Custom Fields card draws it.
             */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50">
              <Icon
                icon={getFileTypeIcon(file.fileType)}
                className="h-5 w-5 text-gray-500"
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <p className="break-words text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                {file.name ||
                  translator.translateTemplate("File {{number}}", {
                    number: i + 1,
                  })}
              </p>
              {metadata.length > 0 && (
                <p className="text-xs text-gray-500">{metadata.join(" • ")}</p>
              )}
            </div>
          </div>
          <div className="ms-auto flex shrink-0 items-center gap-2">
            {/*
             * A picker of one file shows no drop zone while it holds one:
             * Replace opens the file chooser at once.
             */}
            {!props.isMultiFilePicker && !props.readOnly ? (
              <button
                type="button"
                className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                // While a file is uploading there is no chooser to open.
                disabled={isLoading}
                onClick={() => {
                  if (!isLoading) {
                    open();
                  }
                }}
              >
                {translator.translateText("Replace")}
              </button>
            ) : (
              <></>
            )}
            <button
              type="button"
              className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              onClick={removeFile}
            >
              {translator.translateText("Remove")}
            </button>
          </div>
        </div>
      );
    });
  };

  const hasActiveUploads: boolean = uploadStatuses.some(
    (upload: UploadStatus) => {
      return upload.status === "uploading";
    },
  );

  // A picker of several files that holds as many as it may.
  const isFull: boolean = maxFiles !== null && filesModel.length >= maxFiles;

  // The prompt to choose or drop files: an empty picker, or one of several.
  const showsPrompt: boolean =
    !isFull && (filesModel.length === 0 || Boolean(props.isMultiFilePicker));

  /*
   * A picker of one that holds its file shows the file alone: no empty drop
   * zone above it. Its file chooser stays in the page, out of sight, for
   * Replace to open - react-dropzone's open() clicks the input, and does
   * nothing when there is none.
   */
  const isCollapsed: boolean = !isFull && !showsPrompt;

  /*
   * A picker of several that already lists files asks for more in a smaller
   * zone: the files are what the reader came to see, and a second
   * illustration the height of the dialog pushed them out of sight.
   */
  const isCompactPrompt: boolean = showsPrompt && filesModel.length > 0;

  // Whether a click or a key on the zone opens the file chooser.
  const canChoose: boolean = showsPrompt && !props.readOnly && !isLoading;

  const zoneClassName: string = isCollapsed
    ? "sr-only"
    : isFull
      ? // Full: a note, not a place to drop files.
        "flex w-full justify-center rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
      : `flex w-full justify-center rounded-md border-2 border-dashed ${isCompactPrompt ? "px-4 py-4" : "px-6 py-8"} transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${props.readOnly ? "cursor-not-allowed bg-gray-50 border-gray-200" : "cursor-pointer bg-white border-gray-300 hover:border-gray-400"} ${hasActiveUploads ? "ring-1 ring-indigo-200" : ""} ${isDragActive ? "border-indigo-400 bg-indigo-50" : ""}`;

  return (
    <div className="space-y-4 w-full">
      <div
        {...getRootProps({
          className: zoneClassName,
          "aria-busy": hasActiveUploads || isLoading,
          // Nothing to open while it holds its file, is full or read only.
          tabIndex: canChoose ? 0 : -1,
          onClick: (event: React.MouseEvent<HTMLElement>): void => {
            props.onClick?.();
            props.onFocus?.();

            /*
             * Anywhere on the zone opens the file chooser, as the zone says
             * it does - it used to be the link-coloured words alone. Those
             * are the input's label, which opens the chooser by itself, so
             * a click on them is left to the browser: opening it here too
             * would open it twice.
             */
            if (
              !canChoose ||
              (event.target instanceof Element && event.target.closest("label"))
            ) {
              return;
            }

            open();
          },
        })}
        data-testid={props.dataTestId}
      >
        <div className="flex w-full flex-col items-center justify-center space-y-3 text-center">
          {/*
           * The file chooser, whenever the picker can take a file: the
           * prompt's label opens it, and so do a click anywhere on the zone
           * and Replace.
           */}
          {!isFull && (
            <input
              tabIndex={props.tabIndex}
              {...(getInputProps() as any)}
              id={inputId}
              name="file-upload"
              type="file"
              aria-labelledby={props.ariaLabelledby}
              aria-describedby={props.ariaDescribedby}
              className="sr-only"
            />
          )}
          {isFull && (
            <>
              <p
                className="text-sm text-gray-600"
                data-testid="file-picker-full"
              >
                {translator.translateTemplate(
                  "This field holds up to {{count}} files. Remove one to add another.",
                  { count: maxFiles || 0 },
                )}
              </p>
              {/* A file dropped on it anyway, of a kind it does not take. */}
              {error && (
                <p className="text-xs text-red-500 font-medium">{error}</p>
              )}
            </>
          )}
          {showsPrompt && (
            <>
              <div className="flex flex-col items-center space-y-2">
                {isCompactPrompt ? (
                  <></>
                ) : (
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    ></path>
                  </svg>
                )}
                <div className="flex flex-col items-center text-sm text-gray-600 space-y-1">
                  <label
                    htmlFor={inputId}
                    className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-white font-medium text-indigo-600 hover:text-indigo-500 ${isCompactPrompt ? "px-2 py-1" : "px-4 py-2"}`}
                  >
                    {isCompactPrompt ? (
                      <Icon icon={IconProp.Upload} className="h-4 w-4" />
                    ) : (
                      <></>
                    )}
                    <span>
                      {translator.translateText(
                        props.placeholder
                          ? props.placeholder
                          : filesModel.length > 0
                            ? "Add more files"
                            : "Upload files",
                      )}
                    </span>
                  </label>
                  <p className="text-gray-500">
                    {translator.translateText(
                      isDragActive
                        ? props.keepFilesInBrowser
                          ? "Release to add them."
                          : "Release to start uploading."
                        : filesModel.length > 0
                          ? "Click to add more or drag & drop."
                          : // A picker of one takes one file.
                            props.isMultiFilePicker
                            ? "Click to choose files or drag & drop."
                            : "Click to choose a file or drag & drop.",
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {props.hint
                      ? translator.translateText(props.hint)
                      : props.mimeTypes && props.mimeTypes?.length > 0
                        ? translator.translateTemplate(
                            hasOwnLimit
                              ? "Types: {{types}}. Max {{size}} each."
                              : "Types: {{types}}. Max 10MB each.",
                            {
                              size: maxFileSize,
                              types: props.mimeTypes
                                .map((type: MimeType) => {
                                  const enumKey: string | undefined =
                                    Object.keys(MimeType)[
                                      Object.values(MimeType).indexOf(type)
                                    ];
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
                                .join(", "),
                            },
                          )
                        : hasOwnLimit
                          ? translator.translateTemplate("Max {{size}} each.", {
                              size: maxFileSize,
                            })
                          : translator.translateText("Max 10MB each.")}
                  </p>
                  {error && (
                    <p className="text-xs text-red-500 font-medium">{error}</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {uploadStatuses.length > 0 && (
        <div className="space-y-2 w-full">
          <p className="text-sm font-medium text-gray-700 text-left">
            {translator.translateText(
              hasActiveUploads ? "Uploading files" : "Upload status",
            )}
          </p>
          <div className="space-y-2">
            {uploadStatuses.map((upload: UploadStatus) => {
              return (
                <div
                  key={upload.id}
                  className={`rounded border px-3 py-2 ${upload.status === "error" ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}
                >
                  <div className="flex items-center justify-between text-sm">
                    <p className="font-medium text-gray-800 truncate">
                      {upload.name}
                    </p>
                    <span
                      className={`text-xs ${upload.status === "error" ? "text-red-600" : "text-gray-500"}`}
                    >
                      {upload.status === "error"
                        ? translator.translateText("Failed")
                        : `${upload.progress}%`}
                    </span>
                  </div>
                  {/* Progress while it uploads; a failed one has none. */}
                  {upload.status === "error" ? (
                    <></>
                  ) : (
                    <div className="mt-2 h-2 rounded bg-gray-200 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all duration-300"
                        style={{ width: `${Math.min(upload.progress, 100)}%` }}
                      ></div>
                    </div>
                  )}
                  {upload.status === "error" && upload.errorMessage && (
                    <p className="mt-2 text-xs text-red-600 text-left">
                      {upload.errorMessage}
                    </p>
                  )}
                  {upload.status === "error" && (
                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        className="text-xs font-medium text-gray-600 hover:text-gray-800"
                        onClick={() => {
                          removeUploadStatus(upload.id);
                        }}
                      >
                        {translator.translateText("Dismiss")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {filesModel.length > 0 && (
        <div className="space-y-2 w-full">
          {/*
           * A picker of several heads its list, under the zone that adds to
           * it. A picker of one shows its file alone: the field's own label
           * is over it, and "Uploaded files" over one file said more than
           * it held.
           */}
          {props.isMultiFilePicker ? (
            <p className="text-sm font-medium text-gray-700 text-left">
              {translator.translateText(
                // Kept in the browser, they are sent with the form.
                props.keepFilesInBrowser ? "Chosen files" : "Uploaded files",
              )}
            </p>
          ) : (
            <></>
          )}
          <div className="flex flex-col gap-2">{getThumbs()}</div>
        </div>
      )}
      {/*
       * A picker of one holding its file has no prompt to say why a file
       * chosen with Replace was refused: it says so here, under the file.
       */}
      {isCollapsed && error && (
        <p
          className="text-xs text-red-500 font-medium text-left"
          role="alert"
          data-testid="file-picker-error"
        >
          {error}
        </p>
      )}
      {props.error && (
        <p data-testid="error-message" className="text-sm text-red-400">
          {translator.translateText(props.error)}
        </p>
      )}
    </div>
  );
};

export default FilePicker;
