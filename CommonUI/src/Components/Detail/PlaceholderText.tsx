import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    text: string;
}

const PlaceholderText: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div className="text-gray-500">{props.text}</div>;
};

export default PlaceholderText;
