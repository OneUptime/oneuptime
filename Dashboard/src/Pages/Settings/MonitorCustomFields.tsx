import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import Route from 'Common/Types/API/Route';
import MonitorCustomField from 'Model/Models/MonitorCustomField';


const MonitorCustomFields: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <CustomFieldsPageBase 
            {...props}
            title="Monitor Custom Fields"
            currentRoute={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS] as Route
            )}
            modelType={MonitorCustomField}
        />
    );
};

export default MonitorCustomFields;
