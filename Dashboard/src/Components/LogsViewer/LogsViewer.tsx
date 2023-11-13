
import ObjectID from 'Common/Types/ObjectID';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    telemetryServiceIds: Array<ObjectID>;
}

const LabelsElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    
    

    return (
        <div>
            {props.labels.map((label: Label, i: number) => {
                return <LabelElement label={label} key={i} />;
            })}
        </div>
    );
};

export default LabelsElement;
