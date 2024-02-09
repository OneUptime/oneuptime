import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    title: string;
    description: string;
}

const RowLabel: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        // rectangle div with curved corners and text inside in tailwindcss

        <div>
            <div>
                {props.title}
            </div>
            <div>
                {props.description}
            </div>
        </div>
    );
};

export default RowLabel;
