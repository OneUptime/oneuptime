import type Label from 'Model/Models/Label';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import LabelElement from './Label';

export interface ComponentProps {
    labels: Array<Label>;
}

const LabelsElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.labels || props.labels.length === 0) {
        return <p>No labels attached.</p>;
    }

    return (
        <div>
            {props.labels.map((label: Label, i: number) => {
                return <LabelElement label={label} key={i} />;
            })}
        </div>
    );
};

export default LabelsElement;
