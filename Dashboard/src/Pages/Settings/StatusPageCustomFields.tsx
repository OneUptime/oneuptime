import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import Route from 'Common/Types/API/Route';
import StatusPageCustomField from 'Model/Models/StatusPageCustomField';

const StatusPageCustomFields: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <CustomFieldsPageBase
            {...props}
            title="Status Page Custom Fields"
            currentRoute={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS] as Route
            )}
            modelType={StatusPageCustomField}
        />
    );
};

export default StatusPageCustomFields;
