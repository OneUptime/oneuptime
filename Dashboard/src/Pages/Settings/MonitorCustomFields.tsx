import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import MonitorCustomField from 'Model/Models/MonitorCustomField';

const MonitorCustomFields: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <CustomFieldsPageBase
            {...props}
            title="Monitor Custom Fields"
            modelType={MonitorCustomField}
        />
    );
};

export default MonitorCustomFields;
