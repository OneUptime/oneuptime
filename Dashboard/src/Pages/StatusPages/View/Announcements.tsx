import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import StatusPage from 'Model/Models/StatusPage';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const statusPage: StatusPage = new StatusPage();
    statusPage.id = modelId;

    return (
        <Fragment>
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
                    title: 'Announcements',
                    description:
                        'Here are announcements for this status page. This will show up on the status page.',
                }}
                noItemsMessage={'No announcements found.'}
                formFields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Announcement Title',
                        description: 'Title of announcement',
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
                            'Add an announcement note. This is in Markdown.',
                    },
                    {
                        field: {
                            showAnnouncementAt: true,
                        },
                        title: 'Start Showing Announcement At',
                        fieldType: FormFieldSchemaType.DateTime,
                        required: true,
                        placeholder: 'Pick Date and Time',
                    },
                    {
                        field: {
                            endAnnouncementAt: true,
                        },
                        title: 'End Showing Announcement At',
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
        </Fragment>
    );
};

export default StatusPageDelete;
