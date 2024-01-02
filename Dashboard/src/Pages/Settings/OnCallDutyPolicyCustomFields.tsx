import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import OnCallDutyPolicyCustomField from 'Model/Models/OnCallDutyPolicyCustomField';

const OnCallDutyPolicyCustomFields: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <CustomFieldsPageBase
            {...props}
            title="On-Call Policy Custom Fields"
            modelType={OnCallDutyPolicyCustomField}
        />
    );
};

export default OnCallDutyPolicyCustomFields;
