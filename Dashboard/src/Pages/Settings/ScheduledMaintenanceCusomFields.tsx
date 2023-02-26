import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import Route from 'Common/Types/API/Route';
import ScheduledMaintenanceCustomField from 'Model/Models/ScheduledMaintenanceCustomField';


const ScheduledMaintenanceCustomFields: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <CustomFieldsPageBase 
            {...props}
            title="Scheduled Maintenance Custom Fields"
            currentRoute={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS] as Route
            )}
            modelType={ScheduledMaintenanceCustomField}
        />
    );
};

export default ScheduledMaintenanceCustomFields;
