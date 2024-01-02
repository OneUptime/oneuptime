import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import ScheduledMaintenanceCustomField from 'Model/Models/ScheduledMaintenanceCustomField';

const ScheduledMaintenanceCustomFields: FunctionComponent<
    PageComponentProps
> = (props: PageComponentProps): ReactElement => {
    return (
        <CustomFieldsPageBase
            {...props}
            title="Scheduled Maintenance Custom Fields"
            modelType={ScheduledMaintenanceCustomField}
        />
    );
};

export default ScheduledMaintenanceCustomFields;
