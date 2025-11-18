import { FILE_URL } from "../../Config";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import Icon, { SizeProp } from "../Icon/Icon";
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
import { useDropzone } from "react-dropzone";

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
}

const FilePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [filesModel, setFilesModel] = useState<Array<FileModel>>([]);

  const [acceptTypes, setAcceptTypes] = useState<Dictionary<Array<string>>>({});

  useEffect(() => {
    const _acceptTypes: Dictionary<Array<string>> = {};
    if (props.mimeTypes) {
      for (const key of props.mimeTypes) {
        _acceptTypes[key] = [];
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

  const { getRootProps, getInputProps } = useDropzone({
    accept: acceptTypes,
    multiple: props.isMultiFilePicker,
    noClick: true,
    onDrop: async (acceptedFiles: Array<File>) => {
      setIsLoading(true);
      try {
        if (props.readOnly) {
          return;
        }

        // Upload these files.
        const filesResult: Array<FileModel> = [];
        const resolveMimeType = (file: File): MimeType | undefined => {
          const direct: string | undefined = file.type || undefined;
          if (direct && Object.values(MimeType).includes(direct as MimeType)) {
            return direct as MimeType;
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

        for (const acceptedFile of acceptedFiles) {
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
              },
            })) as HTTPResponse<FileModel>;
          filesResult.push(result.data as FileModel);
        }

        const updatedFiles: Array<FileModel> = props.isMultiFilePicker
          ? [...filesModel, ...filesResult]
          : filesResult;

        setFilesModel(updatedFiles);

        props.onBlur?.();
        props.onChange?.(updatedFiles);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
    },
  });

  type GetThumbsFunction = () => Array<ReactElement>;

  const getThumbs: GetThumbsFunction = (): Array<ReactElement> => {
    return filesModel.map((file: FileModel, i: number) => {
      const hasPreview: boolean = Boolean(file.file);
      const key: string = file._id?.toString() || `${file.name || "file"}-${i}`;
      const removeFile = (): void => {
        const tempFileModel: Array<FileModel> = [...filesModel];
        tempFileModel.splice(i, 1);
        setFilesModel(tempFileModel);
        props.onChange?.(tempFileModel);
      };

      if (hasPreview && file.file) {
        const blob: Blob = new Blob([file.file!.buffer as ArrayBuffer], {
          type: file.fileType as string,
        });
        const url: string = URL.createObjectURL(blob);
        return (
          <div key={key} className="relative flex-none">
            <button
              type="button"
              onClick={removeFile}
              className="bg-gray-600 text-white text-xs px-2 py-1 rounded absolute left-1 top-1 hover:bg-gray-700"
            >
              Remove
            </button>
            <Icon
              icon={IconProp.Close}
              className="bg-gray-400 rounded text-white h-6 w-6 flex items-center justify-center absolute -right-2 -top-2 hover:bg-gray-500 cursor-pointer"
              size={SizeProp.Regular}
              onClick={removeFile}
            />
            <img
              src={url}
              className="rounded border border-gray-200 h-24 w-24 object-cover"
            />
          </div>
        );
      }

      return (
        <div
          key={key}
          className="flex w-full items-center justify-between rounded border border-gray-200 bg-gray-50 px-3 py-2"
        >
          <div className="flex items-center gap-3 text-left">
            <Icon icon={IconProp.File} className="text-gray-500" />
            <div>
              <p className="text-sm font-medium text-gray-900">
                {file.name || `File ${i + 1}`}
              </p>
              <p className="text-xs text-gray-500">
                {file.fileType || "Unknown type"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs font-medium text-gray-600 hover:text-gray-800"
              onClick={removeFile}
            >
              Remove
            </button>
            <Icon
              icon={IconProp.Close}
              className="text-gray-400 hover:text-gray-600 cursor-pointer"
              onClick={removeFile}
              size={SizeProp.Regular}
            />
          </div>
        </div>
      );
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center w-full">
        <ComponentLoader />
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full">
      <div
        onClick={() => {
          props.onClick?.();
          props.onFocus?.();
        }}
        data-testid={props.dataTestId}
        className="flex w-full justify-center rounded-md border-2 border-dashed border-gray-300 px-6 py-8"
      >
        <div
          {...getRootProps({
            className:
              "w-full flex flex-col items-center justify-center space-y-3 text-center",
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
                      {props.placeholder
                        ? props.placeholder
                        : filesModel.length > 0
                          ? "Add more files"
                          : "Upload files"}
                    </span>
                    <input
                      tabIndex={props.tabIndex}
                      {...(getInputProps() as any)}
                      id="file-upload"
                      name="file-upload"
                      type="file"
                      className="sr-only"
                    />
                  </label>
                  <p className="text-gray-500">
                    {filesModel.length === 0
                      ? "Click to choose files"
                      : "Click to add more"} or drag & drop.
                  </p>
                  <p className="text-xs text-gray-500">
                    {props.mimeTypes && props.mimeTypes?.length > 0 && (
                      <span>Types: </span>
                    )}
                    {props.mimeTypes &&
                      props.mimeTypes
                        .map((type: MimeType) => {
                          const enumKey: string | undefined =
                            Object.keys(MimeType)[
                              Object.values(MimeType).indexOf(type)
                            ];
                          return enumKey?.toUpperCase() || "";
                        })
                        .filter((item: string | undefined, pos: number, array: Array<string | undefined>) => {
                          return array.indexOf(item) === pos;
                        })
                        .join(", ")}
                    {props.mimeTypes && props.mimeTypes?.length > 0 && <span>.</span>} Max 10MB each.
                  </p>
                  {error && (
                    <p className="text-xs text-red-500 font-medium">
                      {error}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {filesModel.length > 0 && (
        <div className="space-y-2 w-full">
          <p className="text-sm font-medium text-gray-700 text-left">
            Uploaded files
          </p>
          <div className="flex flex-wrap gap-4">{getThumbs()}</div>
        </div>
      )}
      {props.error && (
        <p data-testid="error-message" className="text-sm text-red-400">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default FilePicker;
