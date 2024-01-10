import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import CustomFieldsDetail from 'CommonUI/src/Components/CustomFields/CustomFieldsDetail';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import OnCallDutyPolicyCustomField from 'Model/Models/OnCallDutyPolicyCustomField';
import ProjectUtil from 'CommonUI/src/Utils/Project';

const OnCallDutyPolicyCustomFields: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <CustomFieldsDetail
                title="Custom Fields"
                description="Custom fields help you add new fields to your resources in OneUptime."
                modelType={OnCallDutyPolicy}
                customFieldType={OnCallDutyPolicyCustomField}
                name="Custom Fields"
                projectId={ProjectUtil.getCurrentProject()!.id!}
                modelId={modelId}
            />
        </Fragment>
    );
};

export default OnCallDutyPolicyCustomFields;
