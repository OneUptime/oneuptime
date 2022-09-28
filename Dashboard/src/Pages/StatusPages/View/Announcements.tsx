import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import StatusPage from 'Model/Models/StatusPage';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import StatusPagePreviewLink from './StatusPagePreviewLink';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam(1)?.toString().substring(1) || ''
    );

    const statusPage: StatusPage = new StatusPage();
    statusPage.id = modelId;

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
                    title: 'Announcements',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS
                        ] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <StatusPagePreviewLink modelId={modelId} />
            <ModelTable<StatusPageAnnouncement>
                modelType={StatusPageAnnouncement}
                id="table-status-page-note"
                isDeleteable={true}
                isCreateable={true}
                isEditable={true}
                isViewable={false}
                query={{
                    statusPages: [statusPage],
                    projectId: props.currentProject?._id,
                }}
                onBeforeCreate={(
                    item: StatusPageAnnouncement
                ): Promise<StatusPageAnnouncement> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }

                    const statusPage: StatusPage = new StatusPage();
                    statusPage.id = modelId;

                    item.statusPages = [statusPage];
                    item.projectId = props.currentProject.id;
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
                        description: 'This is in markdown.',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        placeholder: 'Add a announcement note.',
                    },
                    {
                        field: {
                            showAnnouncementAt: true,
                        },
                        title: 'Start Showing Announcement At',
                        description: 'This is in your local timezone',
                        fieldType: FormFieldSchemaType.DateTime,
                        required: true,
                        placeholder: 'Pick Date and Time',
                    },
                    {
                        field: {
                            endAnnouncementAt: true,
                        },
                        title: 'End Showing Announcement At',
                        description: 'This is in your local timezone',
                        fieldType: FormFieldSchemaType.DateTime,
                        required: true,
                        placeholder: 'Pick Date and Time',
                    },
                ]}
                showRefreshButton={true}
                viewPageRoute={props.pageRoute}
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
        </Page>
    );
};

export default StatusPageDelete;
