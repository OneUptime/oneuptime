import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import CustomFieldsDetail from 'CommonUI/src/Components/CustomFields/CustomFieldsDetail';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenanceCustomField from 'Model/Models/ScheduledMaintenanceCustomField';
import ProjectUtil from 'CommonUI/src/Utils/Project';

const ScheduledMaintenanceCustomFields: FunctionComponent<
    PageComponentProps
> = (_props: PageComponentProps): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Page
            title={'Scheduled Maintenance Event'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Scheduled Maintenances',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Scheduled Maintenance',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Custom Fields',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS
                        ] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <CustomFieldsDetail
                title="Scheduled Maintenance Custom Fields"
                description="Custom fields help you add new fields to your resources in OneUptime."
                modelType={ScheduledMaintenance}
                customFieldType={ScheduledMaintenanceCustomField}
                name="Scheduled Maintenance Custom Fields"
                projectId={ProjectUtil.getCurrentProject()!.id!}
                modelId={modelId}
            />
        </Page>
    );
};

export default ScheduledMaintenanceCustomFields;
