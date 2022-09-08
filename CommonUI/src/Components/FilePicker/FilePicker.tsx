import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import { useDropzone } from 'react-dropzone';
import MimeType from 'Common/Types/File/MimeType';
import FileModel from 'Common/Models/FileModel';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import CommonURL from 'Common/Types/API/URL';
import { FILE_URL } from '../../Config';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import Icon, { IconProp, SizeProp, ThickProp } from '../Icon/Icon';
import { White } from 'Common/Types/BrandColors';

export interface ComponentProps {
    initialValue?: undefined | Array<FileModel>;
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
}

const FilePicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const [filesModel, setFilesModel] = useState<Array<FileModel>>([]);

    useEffect(() => {
        if (props.initialValue && props.initialValue.length > 0) {
            setFilesModel(props.initialValue);
        }
    }, [props.initialValue]);

    useEffect(() => {
        setFilesModel(props.value && props.value.length > 0 ? props.value : []);
    }, [props.value]);

    const { getRootProps, getInputProps } = useDropzone({
        accept: {
            'image/*': [],
        },
        onDrop: async (acceptedFiles) => {
            setIsLoading(true);

            if (props.readOnly) {
                return;
            }

            // Upload these files.
            const filesResult: Array<FileModel> = [];
            for (const acceptedFile of acceptedFiles) {
                const fileModel: FileModel = new FileModel();
                fileModel.name = acceptedFile.name;
                const fileBuffer = Buffer.from(
                    await getBase64(acceptedFile),
                    'base64'
                );
                fileModel.file = fileBuffer;
                fileModel.isPublic = false;
                fileModel.type = acceptedFile.type as MimeType;

                const result = await ModelAPI.create(
                    fileModel,
                    CommonURL.fromURL(FILE_URL).addRoute('/file')
                );
                filesResult.push(result.data as FileModel);
            }

            setFilesModel(filesResult);

            props.onBlur && props.onBlur();
            props.onChange && props.onChange(filesModel);
            setIsLoading(false);
        },
    });

    const getBase64 = (file: File): Promise<string> => {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = function () {
                resolve(reader.result as string);
            };
            reader.onerror = function (error) {
                reject(error);
            };
        });
    };

    const getThumbs = (): Array<ReactElement> => {
        return filesModel.map((file: FileModel, i: number) => {
            if (!file.file) {
                return <></>;
            }

            const blob = new Blob(
                [new Uint8Array((file.file as any).data).buffer],
                { type: file.type as string }
            );
            const url: string = URL.createObjectURL(blob);
            return (
                <div key={file.name} className="file-picker-thumb">
                    <div className="file-picker-delete-logo">
                        <Icon
                            style={{
                                marginTop: '-5px',
                            }}
                            icon={IconProp.Close}
                            color={White}
                            thick={ThickProp.Thick}
                            size={SizeProp.Regular}
                            onClick={() => {
                                const tempFileModel = [...filesModel];
                                tempFileModel.splice(i, 1);
                                setFilesModel(tempFileModel);
                            }}
                        />
                    </div>
                    <div className="file-picker-thumb-inner">
                        <img src={url} className="file-picker-img" />
                    </div>
                </div>
            );
        });
    };

    if (isLoading) {
        return <ComponentLoader />;
    }

    return (
        <div
            className={`flex ${props.className}`}
            onClick={() => {
                props.onClick && props.onClick();
                props.onFocus && props.onFocus();
            }}
            id={props.dataTestId}
        >
            <section className="container">
                {props.isMultiFilePicker ||
                    (filesModel.length === 0 && (
                        <div
                            {...getRootProps({
                                className: 'file-picker-dropzone',
                            })}
                        >
                            <input {...getInputProps()} />
                            {!props.placeholder && (
                                <p className="file-picker-placeholder">
                                    Drag 'n' drop some files here, or click to
                                    select files
                                </p>
                            )}
                            {props.placeholder && (
                                <p className="file-picker-placeholder">
                                    {props.placeholder}
                                </p>
                            )}
                        </div>
                    ))}
                <aside className="file-picker-thumbs-container">
                    {getThumbs()}
                </aside>
            </section>
        </div>
    );
};

export default FilePicker;
