import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import Route from 'Common/Types/API/Route';
import OnCallDutyPolicyCustomField from 'Model/Models/OnCallDutyPolicyCustomField';

const OnCallDutyPolicyCustomFields: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <CustomFieldsPageBase
            {...props}
            title="On Call Policy Custom Fields"
            currentRoute={RouteUtil.populateRouteParams(
                RouteMap[
                    PageMap.SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS
                ] as Route
            )}
            modelType={OnCallDutyPolicyCustomField}
        />
    );
};

export default OnCallDutyPolicyCustomFields;
