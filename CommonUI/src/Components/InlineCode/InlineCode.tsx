import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    text: string;
}

const InlineCode: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <span className="font-medium text-xs text-gray-500 border-gray-300 border-2 p-1 pl-2 pr-2 rounded">
            {props.text}
        </span>
    );
};

export default InlineCode;
