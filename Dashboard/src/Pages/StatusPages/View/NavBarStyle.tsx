import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
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
        <Page
            title={'Status Page'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Navbar',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE
                        ] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <CardModelDetail<StatusPage>
                name="Statusn Page > Branding > Nav Bar Menu Colors"
                cardProps={{
                    title: 'Navigation Menu Colors',
                    description:
                        'Navigation Menu background color and text colors for your status page',
                    icon: IconProp.Layers,
                }}
                editButtonText={'Edit Colors'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            navBarBackgroundColor: true,
                        },
                        title: 'Navigation Menu Background Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: false,
                        placeholder: '#ffffff',
                    },
                    {
                        field: {
                            navBarTextColor: true,
                        },
                        title: 'Navigation Menu Text Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: false,
                        placeholder: '#000000',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                navBarBackgroundColor: true,
                            },
                            fieldType: FieldType.Color,
                            title: 'Navigation Menu Background Color',
                            placeholder: '#f8f8f8',
                        },
                        {
                            field: {
                                navBarTextColor: true,
                            },
                            fieldType: FieldType.Color,
                            title: 'Header Text Color',
                            placeholder: '#000000',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Statusn Page > Branding > Nav Bar Settings"
                cardProps={{
                    title: 'Page Settings',
                    description: 'Settings for pages on your status page.',
                    icon: IconProp.Settings,
                }}
                editButtonText={'Edit Page Settings'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            showOverviewPage: true,
                        },
                        title: 'Show Overview Page',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                    },
                    {
                        field: {
                            showIncidentsPage: true,
                        },
                        title: 'Show Incidents Page',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                    },
                    {
                        field: {
                            showAnouncementsPage: true,
                        },
                        title: 'Show Announcements Page',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                    },
                    {
                        field: {
                            showScheduledMaintenancePage: true,
                        },
                        title: 'Show Scheduled Maintenance Page',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                    },
                    {
                        field: {
                            enableSubscribers: true,
                        },
                        title: 'Enable Subscribers',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                    },
                    // {
                    //     field: {
                    //         showRssPage: true,
                    //     },
                    //     title: 'Enable RSS Page',
                    //     fieldType: FormFieldSchemaType.Checkbox,
                    //     required: false,
                    // },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                showOverviewPage: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Show Overview Page',
                        },
                        {
                            field: {
                                showIncidentsPage: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Show Incidents Page',
                        },
                        {
                            field: {
                                showScheduledMaintenancePage: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Show Scheduled Maintenance Page',
                        },
                        {
                            field: {
                                showAnouncementsPage: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Show Announcements Page',
                        },
                        {
                            field: {
                                enableSubscribers: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Enable Subscribers',
                        },
                        // {
                        //     field: {
                        //         showRssPage: true,
                        //     },
                        //     fieldType: FieldType.Boolean,
                        //     title: 'Enable RSS',
                        // },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Statusn Page > Branding > Advanced Settings"
                cardProps={{
                    title: 'Advanced Navigation Menu Settings',
                    description:
                        'Advanced settings for your status page navigation menu.',
                    icon: IconProp.Settings,
                }}
                editButtonText={'Edit Settings'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            showNavbar: true,
                        },
                        title: 'Show Navigation Menu on Status Page',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                showNavbar: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Show Navigation Menu on Status Page',
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Page>
    );
};

export default StatusPageDelete;
