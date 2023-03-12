import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import ModelTable, {
    ShowTableAs,
} from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IconProp from 'Common/Types/Icon/IconProp';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import UserElement from '../../../Components/User/User';
import User from 'Model/Models/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Navigation from 'CommonUI/src/Utils/Navigation';
import AlignItem from 'CommonUI/src/Types/AlignItem';
import { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
const PublicNote: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
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
                    title: 'Scheduled Maintenance Events',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Scheduled Maintenance Event',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Public Notes',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE
                        ] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<ScheduledMaintenancePublicNote>
                modelType={ScheduledMaintenancePublicNote}
                id="table-scheduled-maintenance-internal-note"
                name="Scheduled Maintenance Events > Public Notes"
                isDeleteable={true}
                createEditModalWidth={ModalWidth.Large}
                isCreateable={true}
                isEditable={true}
                isViewable={false}
                query={{
                    scheduledMaintenanceId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: ScheduledMaintenancePublicNote
                ): Promise<ScheduledMaintenancePublicNote> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.scheduledMaintenanceId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.User,
                    title: 'Public Notes',
                    description:
                        'Here are public notes for this scheduled maintenance. This will show up on the status page.',
                }}
                noItemsMessage={
                    'No public notes created for this scheduled maintenance so far.'
                }
                formFields={[
                    {
                        field: {
                            note: true,
                        },
                        title: 'Public Scheduled Maintenance Note',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        description:
                            'This note is visible on your Status Page. This is in Markdown.',
                    },
                ]}
                showRefreshButton={true}
                showTableAs={ShowTableAs.List}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            createdByUser: {
                                name: true,
                                email: true,
                                profilePictureId: true,
                            },
                        },
                        title: '',

                        type: FieldType.Entity,
                        isFilterable: true,

                        getElement: (item: JSONObject): ReactElement => {
                            if (item['createdByUser']) {
                                return (
                                    <UserElement
                                        user={
                                            JSONFunctions.fromJSON(
                                                item[
                                                    'createdByUser'
                                                ] as JSONObject,
                                                User
                                            ) as User
                                        }
                                        suffix={'wrote'}
                                        usernameClassName={
                                            'text-base font-medium text-gray-900'
                                        }
                                        suffixClassName={
                                            'text-base font-medium text-gray-500 mt-1'
                                        }
                                    />
                                );
                            }
                            return <></>;
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        isFilterable: true,
                        alignItem: AlignItem.Right,
                        title: '',
                        type: FieldType.DateTime,
                        contentClassName:
                            'mt-1 whitespace-nowrap text-sm text-gray-600 sm:mt-0 sm:ml-3',
                    },
                    {
                        field: {
                            note: true,
                        },
                        isFilterable: true,
                        title: '',
                        type: FieldType.Markdown,
                        contentClassName:
                            '-mt-3 space-y-6 text-sm text-gray-800',
                        colSpan: 2,
                    },
                ]}
            />
        </Page>
    );
};

export default PublicNote;
