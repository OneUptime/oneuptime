import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    label: string | ReactElement;
}

const BarLabel: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        // rectangle div with curved corners and text inside in tailwindcss

        <div className="text-center text-sm font-medium">{props.label}</div>
    );
};

export default BarLabel;
