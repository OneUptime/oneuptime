import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IconProp from 'Common/Types/Icon/IconProp';
import StatusPage from 'Model/Models/StatusPage';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import OneUptimeDate from 'Common/Types/Date';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const statusPage: StatusPage = new StatusPage();
    statusPage.id = modelId;

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
                    title: 'Announcements',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<StatusPageAnnouncement>
                modelType={StatusPageAnnouncement}
                id="table-status-page-note"
                isDeleteable={true}
                isCreateable={true}
                showViewIdButton={true}
                isEditable={true}
                name="Status Page > Announcements"
                isViewable={false}
                query={{
                    statusPages: [statusPage],
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: StatusPageAnnouncement
                ): Promise<StatusPageAnnouncement> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }

                    const statusPage: StatusPage = new StatusPage();
                    statusPage.id = modelId;

                    item.statusPages = [statusPage];
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.SMS,
                    title: 'Announcements',
                    description:
                        'Here are announcements this status page. This will show up on the status page.',
                }}
                noItemsMessage={'No announcements found.'}
                formFields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Announcement Title',
                        description: 'Title of announcemnet',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Title',
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        description:
                            'Add a announcement note. This is in Markdown.',
                    },
                    {
                        field: {
                            showAnnouncementAt: true,
                        },
                        title: 'Start Showing Announcement At',
                        description:
                            'This is in your local timezone - ' +
                            OneUptimeDate.getCurrentTimezoneString(),
                        fieldType: FormFieldSchemaType.DateTime,
                        required: true,
                        placeholder: 'Pick Date and Time',
                    },
                    {
                        field: {
                            endAnnouncementAt: true,
                        },
                        title: 'End Showing Announcement At',
                        description:
                            'This is in your local timezone - ' +
                            OneUptimeDate.getCurrentTimezoneString(),
                        fieldType: FormFieldSchemaType.DateTime,
                        required: true,
                        placeholder: 'Pick Date and Time',
                    },
                ]}
                showRefreshButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            showAnnouncementAt: true,
                        },
                        title: 'Show Announcement At',
                        type: FieldType.DateTime,
                    },
                    {
                        field: {
                            endAnnouncementAt: true,
                        },
                        title: 'End Announcement At',
                        type: FieldType.DateTime,
                    },
                ]}
            />
        </ModelPage>
    );
};

export default StatusPageDelete;
