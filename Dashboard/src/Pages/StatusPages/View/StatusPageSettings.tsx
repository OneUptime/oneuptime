import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import IconProp from 'Common/Types/Icon/IconProp';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Status Page"
            modelType={StatusPage}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <CardModelDetail<StatusPage>
                name="Status Page >  Settings"
                cardProps={{
                    title: 'Status Page Settings',
                    description: 'Settings for this status page.',
                    icon: IconProp.Settings,
                }}
                editButtonText="Edit Settings"
                isEditable={true}
                formFields={[
                    {
                        field: {
                            showIncidentHistoryInDays: true,
                        },
                        title: 'Show Incident History (in days)',
                        fieldType: FormFieldSchemaType.Number,
                        required: true,
                        placeholder: '14',
                    },
                    {
                        field: {
                            showAnnouncementHistoryInDays: true,
                        },
                        title: 'Show Announcement History (in days)',
                        fieldType: FormFieldSchemaType.Number,
                        required: true,
                        placeholder: '14',
                    },
                    {
                        field: {
                            showScheduledEventHistoryInDays: true,
                        },
                        title: 'Show Scheduled Event History (in days)',
                        fieldType: FormFieldSchemaType.Number,
                        required: true,
                        placeholder: '14',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                showIncidentHistoryInDays: true,
                            },
                            fieldType: FieldType.Number,
                            title: 'Show Incident History (in days)',
                        },
                        {
                            field: {
                                showAnnouncementHistoryInDays: true,
                            },
                            fieldType: FieldType.Number,
                            title: 'Show Announcement History (in days)',
                        },
                        {
                            field: {
                                showScheduledEventHistoryInDays: true,
                            },
                            fieldType: FieldType.Number,
                            title: 'Show Scheduled Event History (in days)',
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </ModelPage>
    );
};

export default StatusPageDelete;
