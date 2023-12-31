import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import CustomFieldsDetail from 'CommonUI/src/Components/CustomFields/CustomFieldsDetail';
import StatusPage from 'Model/Models/StatusPage';
import StatusPageCustomField from 'Model/Models/StatusPageCustomField';
import ProjectUtil from 'CommonUI/src/Utils/Project';

const StatusPageCustomFields: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <CustomFieldsDetail
                title="Status Page Custom Fields"
                description="Custom fields help you add new fields to your resources in OneUptime."
                modelType={StatusPage}
                customFieldType={StatusPageCustomField}
                name="Status Page Custom Fields"
                projectId={ProjectUtil.getCurrentProject()!.id!}
                modelId={modelId}
            />
        </Fragment>
    );
};

export default StatusPageCustomFields;
