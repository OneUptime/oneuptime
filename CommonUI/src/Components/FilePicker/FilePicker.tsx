import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import { useDropzone } from 'react-dropzone';

export interface ComponentProps {
    initialValue?: undefined | string;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string) => void);
    value?: string | undefined;
    readOnly?: boolean | undefined;
    type?: 'text' | 'number' | 'date';
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    dataTestId?: string;
}

const FilePicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [files, setFiles] = useState<Array<File>>([]);
    const [fileObjectURLs, setFileObjectURLs] = useState<Array<string>>([]);
    const { getRootProps, getInputProps } = useDropzone({
        accept: {
            'image/*': [],
        },
        onDrop: acceptedFiles => {
            setFiles(
                acceptedFiles.map((file) => {
                    return Object.assign(file, {
                        preview: URL.createObjectURL(file),
                    });
                })
            );
        },
    });

    const thumbs = files.map((file) => {
        const url: string = URL.createObjectURL(file);
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
    });

    useEffect(() => {
        // Make sure to revoke the data uris to avoid memory leaks, will run on unmount
        return () => {
            return fileObjectURLs.forEach(fileURL => {
                return URL.revokeObjectURL(fileURL);
            });
        };
    }, []);

    return (
        <section className="container">
            <div {...getRootProps({ className: 'dropzone' })}>
                <input {...getInputProps()} />
                <p>Drag 'n' drop some files here, or click to select files</p>
            </div>
            <aside className="file-picker-thumb-container">{thumbs}</aside>
        </section>
    );
};

export default FilePicker;
