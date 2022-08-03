import Label from 'Model/Models/Label';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Black } from 'CommonUI/src/Utils/BrandColors';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    label: Label;
}

const LabelElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Pill
            color={props.label.color || Black}
            text={props.label.name || ''}
            style={{
                marginRight: '5px',
            }}
        />
    );
};

export default LabelElement;
