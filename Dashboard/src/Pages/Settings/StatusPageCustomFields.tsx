import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import StatusPageCustomField from 'Model/Models/StatusPageCustomField';
import React, { FunctionComponent, ReactElement } from 'react';

const StatusPageCustomFields: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <CustomFieldsPageBase
            {...props}
            title="Status Page Custom Fields"
            modelType={StatusPageCustomField}
        />
    );
};

export default StatusPageCustomFields;
