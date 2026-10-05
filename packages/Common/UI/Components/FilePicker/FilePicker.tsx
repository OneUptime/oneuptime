import { FILE_URL } from "../../Config";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Icon from "../Icon/Icon";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import CommonURL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import MimeType from "../../../Types/File/MimeType";
import IconProp from "../../../Types/Icon/IconProp";
import FileModel from "../../../Models/DatabaseModels/File";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
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
  /*
   * The largest file this picker takes, in bytes, when it is less than the
   * 10 MB every upload is held to - a form's logo takes 512 KB. A larger
   * file is refused here, before it is uploaded, and the hint under the
   * picker says the same limit, so the picker never promises more than the
   * field will keep.
   */
  maxFileSizeInBytes?: number | undefined;
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
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

        for (const acceptedFile of acceptedFiles) {
          if (acceptedFile.size > maxFileSizeBytes) {
            oversizedFiles.push(acceptedFile.name);
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
            fileModel.isPublic = false;
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
            removeUploadStatus(uploadId);
          } catch (uploadErr) {
            const friendlyMessage: string = API.getFriendlyMessage(uploadErr);
            updateUploadStatus(uploadId, {
              status: "error",
              errorMessage: friendlyMessage,
              progress: 100,
            });
            setError(friendlyMessage);
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

  const formatFileSize: FormatFileSizeFunction = (
    file: FileModel,
  ): string | null => {
    const buffer: Buffer | undefined = file.file;
    if (!buffer) {
      return null;
    }

    const sizeInKB: number = buffer.byteLength / 1024;
    if (sizeInKB < 1024) {
      return `${sizeInKB.toFixed(1)} KB`;
    }

    return `${(sizeInKB / 1024).toFixed(2)} MB`;
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
      if (file.fileType) {
        metadata.push(file.fileType);
      }
      const readableSize: string | null = formatFileSize(file);
      if (readableSize) {
        metadata.push(readableSize);
      }

      return (
        <div
          key={key}
          className="flex w-full items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm"
        >
          <div className="flex items-start gap-3 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-gray-200 bg-gray-50">
              <Icon icon={IconProp.File} className="text-gray-500" />
            </div>
            <div className="flex flex-col">
              <p className="text-sm font-medium text-gray-900">
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
          <button
            type="button"
            className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            onClick={removeFile}
          >
            {translator.translateText("Remove")}
          </button>
        </div>
      );
    });
  };

  const hasActiveUploads: boolean = uploadStatuses.some(
    (upload: UploadStatus) => {
      return upload.status === "uploading";
    },
  );

  return (
    <div className="space-y-4 w-full">
      <div
        onClick={() => {
          props.onClick?.();
          props.onFocus?.();
        }}
        data-testid={props.dataTestId}
        className={`flex w-full justify-center rounded-md border-2 border-dashed px-6 py-8 transition ${props.readOnly ? "cursor-not-allowed bg-gray-50 border-gray-200" : "bg-white border-gray-300"} ${hasActiveUploads ? "ring-1 ring-indigo-200" : ""} ${isDragActive ? "border-indigo-400" : ""}`}
      >
        <div
          {...getRootProps({
            className:
              "w-full flex flex-col items-center justify-center space-y-3 text-center",
            "aria-busy": hasActiveUploads || isLoading,
          })}
        >
          {(filesModel.length === 0 || props.isMultiFilePicker) && (
            <>
              <div className="flex flex-col items-center space-y-2">
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
                <div className="flex flex-col items-center text-sm text-gray-600 space-y-1">
                  <label className="relative cursor-pointer rounded-md bg-white px-4 py-2 font-medium text-indigo-600 hover:text-indigo-500">
                    <span>
                      {translator.translateText(
                        props.placeholder
                          ? props.placeholder
                          : filesModel.length > 0
                            ? "Add more files"
                            : "Upload files",
                      )}
                    </span>
                    <input
                      tabIndex={props.tabIndex}
                      {...(getInputProps() as any)}
                      id="file-upload"
                      name="file-upload"
                      type="file"
                      aria-labelledby={props.ariaLabelledby}
                      className="sr-only"
                    />
                  </label>
                  <p className="text-gray-500">
                    {translator.translateText(
                      isDragActive
                        ? "Release to start uploading."
                        : filesModel.length === 0
                          ? "Click to choose files or drag & drop."
                          : "Click to add more or drag & drop.",
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {props.mimeTypes && props.mimeTypes?.length > 0
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
                  <div className="mt-2 h-2 rounded bg-gray-200 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${upload.status === "error" ? "bg-red-400" : "bg-indigo-500"}`}
                      style={{ width: `${Math.min(upload.progress, 100)}%` }}
                    ></div>
                  </div>
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
          <p className="text-sm font-medium text-gray-700 text-left">
            {translator.translateText("Uploaded files")}
          </p>
          <div className="flex flex-wrap gap-4">{getThumbs()}</div>
        </div>
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
