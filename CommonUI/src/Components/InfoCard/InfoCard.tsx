import React, { FunctionComponent, ReactElement } from 'react';
import FieldLabelElement from '../Detail/FieldLabel';

export interface ComponentProps {
    title: string;
    value: string | ReactElement;
}

const InfoCard: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="rounded-md bg-white shadow-md p-5">
            <div>
                <FieldLabelElement title={props.title} />
            </div>
            <div>{props.value}</div>
        </div>
    );
};

export default InfoCard;
