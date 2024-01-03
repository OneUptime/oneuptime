import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import CustomFieldsDetail from 'CommonUI/src/Components/CustomFields/CustomFieldsDetail';
import Monitor from 'Model/Models/Monitor';
import MonitorCustomField from 'Model/Models/MonitorCustomField';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import DisabledWarning from '../../../Components/Monitor/DisabledWarning';

const MonitorCustomFields: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <DisabledWarning monitorId={modelId} />
            <CustomFieldsDetail
                title="Monitor Custom Fields"
                description="Custom fields help you add new fields to your resources in OneUptime."
                modelType={Monitor}
                customFieldType={MonitorCustomField}
                name="Monitor Custom Fields"
                projectId={ProjectUtil.getCurrentProject()!.id!}
                modelId={modelId}
            />
        </Fragment>
    );
};

export default MonitorCustomFields;
