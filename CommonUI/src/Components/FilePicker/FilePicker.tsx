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
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';

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
    const [error, setError] = useState<string>('');
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



                    const arrayBuffer = await acceptedFile.arrayBuffer();

                    const blob = new Blob([new Uint8Array(arrayBuffer)]);
                    

                    const _url: string = URL.createObjectURL(blob);
                    const url: string = URL.createObjectURL(acceptedFile);

                    console.log(_url);
                    console.log(url);

                    const fileBuffer = new Uint8Array(arrayBuffer)
                    fileModel.file = Buffer.from(fileBuffer);
                    fileModel.isPublic = false;
                    fileModel.type = acceptedFile.type as MimeType;

                    const result: HTTPResponse<FileModel> =
                        (await ModelAPI.create<FileModel>(
                            fileModel,
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

    const getThumbs = (): Array<ReactElement> => {
        return filesModel.map((file: FileModel, i: number) => {
            if (!file.file) {
                return <></>;
            }

            const blob = new Blob([file.file as Uint8Array], {
                type: file.type as string,
            });
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
                                props.onChange && props.onChange(tempFileModel);
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
                            {!props.placeholder && !error && (
                                <p className="file-picker-placeholder">
                                    Drag and drop some files here, or click to
                                    select files.
                                </p>
                            )}
                            {error && (
                                <p className="file-picker-placeholder">
                                    {error}
                                </p>
                            )}
                            {props.placeholder && !error && (
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
