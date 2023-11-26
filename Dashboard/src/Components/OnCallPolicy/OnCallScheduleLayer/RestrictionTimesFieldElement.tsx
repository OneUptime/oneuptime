import RestrictionTimes from 'Common/Types/OnCallDutyPolicy/RestrictionTimes';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    error?: string | undefined;
    onChange?: ((value: RestrictionTimes) => void) | undefined;
    onBlur?: () => void;
    initialValue?: RestrictionTimes | undefined;
}

const RestrictionTimesFieldElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
       <div></div>
    );
};

export default RestrictionTimesFieldElement;
