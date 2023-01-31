import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import { useDropzone } from 'react-dropzone';
import MimeType from 'Common/Types/File/MimeType';
import FileModel from 'Model/Models/File';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import CommonURL from 'Common/Types/API/URL';
import { FILE_URL } from '../../Config';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import Icon, { IconProp, SizeProp } from '../Icon/Icon';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Dictionary from 'Common/Types/Dictionary';

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
    dataTestId?: string;
    isMultiFilePicker?: boolean | undefined;
    tabIndex?: number | undefined;
    error?: string | undefined;
}

const FilePicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [filesModel, setFilesModel] = useState<Array<FileModel>>([]);

    const [acceptTypes, setAcceptTypes] = useState<Dictionary<Array<string>>>(
        {}
    );

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
        setInitalValue();
    }, [props.initialValue]);

    const setInitalValue: Function = () => {
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
            setFilesModel(
                props.value && props.value.length > 0 ? props.value : []
            );
        } else {
            setInitalValue();
        }
    }, [props.value]);

    const { getRootProps, getInputProps } = useDropzone({
        accept: acceptTypes,
        multiple: props.isMultiFilePicker,
        onDrop: async (acceptedFiles: Array<File>) => {
            setIsLoading(true);
            try {
                if (props.readOnly) {
                    return;
                }

                // Upload these files.
                const filesResult: Array<FileModel> = [];
                for (const acceptedFile of acceptedFiles) {
                    const fileModel: FileModel = new FileModel();
                    fileModel.name = acceptedFile.name;

                    const arrayBuffer: ArrayBuffer =
                        await acceptedFile.arrayBuffer();

                    const fileBuffer: Uint8Array = new Uint8Array(arrayBuffer);
                    fileModel.file = Buffer.from(fileBuffer);
                    fileModel.isPublic = false;
                    fileModel.type = acceptedFile.type as MimeType;

                    const result: HTTPResponse<FileModel> =
                        (await ModelAPI.create<FileModel>(
                            fileModel,
                            FileModel,
                            CommonURL.fromURL(FILE_URL).addRoute('/file')
                        )) as HTTPResponse<FileModel>;
                    filesResult.push(result.data as FileModel);
                }

                setFilesModel(filesResult);

                props.onBlur && props.onBlur();
                props.onChange && props.onChange(filesResult);
            } catch (err) {
                try {
                    setError(
                        (err as HTTPErrorResponse).message ||
                            'Server Error. Please try again'
                    );
                } catch (e) {
                    setError('Server Error. Please try again');
                }
            }
            setIsLoading(false);
        },
    });

    const getThumbs: Function = (): Array<ReactElement> => {
        return filesModel.map((file: FileModel, i: number) => {
            if (!file.file) {
                return <></>;
            }

            const blob: Blob = new Blob([file.file as Uint8Array], {
                type: file.type as string,
            });
            const url: string = URL.createObjectURL(blob);

            return (
                <div key={file.name}>
                    <div className="text-right flex justify-end">
                        <Icon
                            icon={IconProp.Close}
                            className="bg-gray-400 rounded text-white h-7 w-7 align-right items-right p-1 absolute hover:bg-gray-500 cursor-pointer -ml-7"
                            size={SizeProp.Regular}
                            onClick={() => {
                                const tempFileModel: Array<FileModel> = [
                                    ...filesModel,
                                ];
                                tempFileModel.splice(i, 1);
                                setFilesModel(tempFileModel);
                                props.onChange && props.onChange(tempFileModel);
                            }}
                        />
                    </div>
                    <div>
                        <img src={url} className="rounded" />
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
        <div>
            <div
                onClick={() => {
                    props.onClick && props.onClick();
                    props.onFocus && props.onFocus();
                }}
                data-testid={props.dataTestId}
                className="flex max-w-lg justify-center rounded-md border-2 border-dashed border-gray-300 px-6 pt-5 pb-6"
            >
                {props.isMultiFilePicker ||
                    (filesModel.length === 0 && (
                        <div
                            {...getRootProps({
                                className: 'space-y-1 text-center',
                            })}
                        >
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
                            <div className="flex text-sm text-gray-600">
                                <label className="relative cursor-pointer rounded-md bg-white font-medium text-indigo-600 focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 hover:text-indigo-500">
                                    {!props.placeholder && !error && (
                                        <span>{'Upload a file'}</span>
                                    )}

                                    {error && (
                                        <span>
                                            <span>{error}</span>
                                        </span>
                                    )}

                                    {props.placeholder && !error && (
                                        <span>{props.placeholder}</span>
                                    )}

                                    <input
                                        tabIndex={props.tabIndex}
                                        {...getInputProps()}
                                        id="file-upload"
                                        name="file-upload"
                                        type="file"
                                        className="sr-only"
                                    />
                                </label>
                                <p className="pl-1">or drag and drop</p>
                            </div>
                            <p className="text-xs text-gray-500">
                                {props.mimeTypes &&
                                    props.mimeTypes?.length > 0 && (
                                        <span>File types: </span>
                                    )}
                                {props.mimeTypes &&
                                    props.mimeTypes
                                        .map((type: MimeType) => {
                                            const enumKey: string | undefined =
                                                Object.keys(MimeType)[
                                                    Object.values(
                                                        MimeType
                                                    ).indexOf(type)
                                                ];
                                            return enumKey?.toUpperCase() || '';
                                        })
                                        .filter(
                                            (
                                                item: string | undefined,
                                                pos: number,
                                                array: Array<string | undefined>
                                            ) => {
                                                return (
                                                    array.indexOf(item) === pos
                                                );
                                            }
                                        )
                                        .join(', ')}
                                {props.mimeTypes &&
                                    props.mimeTypes?.length > 0 && (
                                        <span>.</span>
                                    )}
                                &nbsp;10 MB or less.
                            </p>
                        </div>
                    ))}
                <aside>{getThumbs()}</aside>
            </div>
            {props.error && (
                <p
                    data-testid="error-message"
                    className="mt-1 text-sm text-red-400"
                >
                    {props.error}
                </p>
            )}
        </div>
    );
};

export default FilePicker;
