import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    onClick: () => void;
    imageUrl: URL | Route;
    height?: number | undefined;
}

const Image: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <img
            onClick={() => {
                props.onClick && props.onClick();
            }}
            src={props.imageUrl.toString()}
            height={props.height}
        />
    );
};

export default Image;
