import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    onClick: () => void;
    imageUrl: URL | Route;
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
            height={30}
        />
    );
};

export default Image;
