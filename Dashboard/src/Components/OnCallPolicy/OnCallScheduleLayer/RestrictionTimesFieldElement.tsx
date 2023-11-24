import RestrictionTimes from 'Common/Types/OnCallDutyPolicy/RestrictionTimes';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    restrictionTimes: RestrictionTimes;
}

const RestrictionTimesFieldElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
       <div></div>
    );
};

export default RestrictionTimesFieldElement;
