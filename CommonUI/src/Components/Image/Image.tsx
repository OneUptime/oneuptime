import Route from 'Common/Types/API/Route';
import BadDataException from 'Common/Types/Exception/BadDataException';
import File from 'Model/Models/File';
import React, { FunctionComponent, ReactElement } from 'react';
import URLFromProject from 'Common/Types/API/URL';

export interface ComponentProps {
    onClick?: () => void | undefined;
    imageUrl?: URLFromProject | Route | undefined;
    height?: number | undefined;
    file?: File | undefined;
    className?: string | undefined;
}

export class ImageFunctions {
    public static getImageURL(file: File): string {
        const blob: Blob = new Blob([file.file as Uint8Array], {
            type: (file as File).type as string,
        });

        const url: string = URL.createObjectURL(blob);
        return url;
    }
}

const Image: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (props.imageUrl) {
        return (
            <img
                onClick={() => {
                    props.onClick && props.onClick();
                }}
                src={props.imageUrl.toString()}
                height={props.height}
                className={props.className}
            />
        );
    }

    if (props.file && props.file.file && props.file.type) {
        const url: string = ImageFunctions.getImageURL(props.file);

        return (
            <img
                onClick={() => {
                    props.onClick && props.onClick();
                }}
                src={url}
                height={props.height}
                className={props.className}
            />
        );
    }

    throw new BadDataException('file or imageUrl required for <Image>');
};

export default Image;
