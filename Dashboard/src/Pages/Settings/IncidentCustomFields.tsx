import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import Route from 'Common/Types/API/Route';
import IncidentCustomField from 'Model/Models/IncidentCustomField';


const IncidentCustomFields: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <CustomFieldsPageBase 
            {...props}
            title="Incident Custom Fields"
            currentRoute={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS] as Route
            )}
            modelType={IncidentCustomField}
        />
    );
};

export default IncidentCustomFields;
