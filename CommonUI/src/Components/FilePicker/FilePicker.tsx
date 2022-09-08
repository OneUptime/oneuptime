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
import Loader, { LoaderType } from '../Loader/Loader';
import { VeryLightGrey } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';

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
}

const FilePicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [isLoading, setIsLoading] = useState<boolean>(false);

    const [filesModel, setFilesModel] = useState<Array<FileModel>>([]);

    const [fileObjectURLs, setFileObjectURLs] = useState<Array<string>>([]);

    useEffect(() => {
        if (props.initialValue) {
            setFilesModel(props.initialValue);
        }
    }, [props.initialValue]);


    useEffect(() => {
        setFilesModel(props.value ? props.value : []);
    }, [props.value]);


    useEffect(() => {
        // Make sure to revoke the data uris to avoid memory leaks, will run on unmount
        return () => {
            return fileObjectURLs.forEach(fileURL => {
                return URL.revokeObjectURL(fileURL);
            });
        };
    }, []);


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
                const fileBuffer = Buffer.from(await getBase64(acceptedFile), 'base64')
                fileModel.file = fileBuffer;
                fileModel.type = acceptedFile.type as MimeType;

                const result = await ModelAPI.create(fileModel, CommonURL.fromURL(FILE_URL).addRoute('/file'));
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
    }

    const getThumbs = () => {
        return filesModel.map((file: FileModel) => {
            //const url: string = URL.createObjectURL(file);
            const url: string = 'data:image/jpeg;base64,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';
            
            const urlArr = [...fileObjectURLs];
            
            urlArr.push(url);

            setFileObjectURLs(urlArr);

            return (
                <div className="file-picker-thumb" key={file.name}>
                    <div className="file-picker-thumb-inner">
                        <img
                            src={url}
                            className="file-picker-img"
                            // Revoke data uri after image is loaded
                            onLoad={() => {
                                URL.revokeObjectURL(url);
                            }}
                        />
                    </div>
                </div>
            );
        }
        )
    };



    if (isLoading) {
        return <Loader
            loaderType={LoaderType.Bar}
            color={VeryLightGrey as Color}
            size={200}
        />
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
                <div {...getRootProps({ className: 'file-picker-dropzone' })}>
                    <input {...getInputProps()} />
                    {!props.placeholder && <p className='file-picker-placeholder'>Drag 'n' drop some files here, or click to select files</p>}
                    {props.placeholder && <p className='file-picker-placeholder'>{props.placeholder}</p>}
                </div>
                <aside className="file-picker-thumb-container">{getThumbs()}</aside>
            </section>
        </div>
    );
};

export default FilePicker;
