import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ScheduledMaintenanceInternalNote from 'Model/Models/ScheduledMaintenanceInternalNote';
import ModelTable, {
    ShowTableAs,
} from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import UserElement from '../../../Components/User/User';
import User from 'Model/Models/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Navigation from 'CommonUI/src/Utils/Navigation';
import AlignItem from 'CommonUI/src/Types/AlignItem';
import { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
const ScheduledMaintenanceDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Scheduled Event"
            modelType={ScheduledMaintenance}
            modelId={modelId}
            modelNameField="title"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Scheduled Maintenance Events',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Scheduled Maintenance Event',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Private Notes',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<ScheduledMaintenanceInternalNote>
                modelType={ScheduledMaintenanceInternalNote}
                id="table-scheduled-maintenance-internal-note"
                name="Scheduled Maintenance Events > Internal Note"
                isDeleteable={true}
                isCreateable={true}
                isEditable={true}
                isViewable={false}
                showViewIdButton={true}
                createEditModalWidth={ModalWidth.Large}
                query={{
                    scheduledMaintenanceId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: ScheduledMaintenanceInternalNote
                ): Promise<ScheduledMaintenanceInternalNote> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.scheduledMaintenanceId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: 'Private Notes',
                    description:
                        'Here are private notes for this scheduled maintenance.',
                }}
                noItemsMessage={
                    'No private notes created for this scheduled maintenance so far.'
                }
                formFields={[
                    {
                        field: {
                            note: true,
                        },
                        title: 'Private Scheduled Maintenance Note',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        description:
                            'Add a private note to this scheduled maintenance here. This is in Markdown.',
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
                            return (
                                <UserElement
                                    user={
                                        JSONFunctions.fromJSON(
                                            item['createdByUser'] as JSONObject,
                                            User
                                        ) as User
                                    }
                                    suffix={'wrote'}
                                    usernameClassName={
                                        'text-base text-gray-900'
                                    }
                                    suffixClassName={
                                        'text-base text-gray-500 mt-1'
                                    }
                                />
                            );
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
                            'mt-1 whitespace-nowrap text-sm text-gray-600 sm:mt-0 sm:ml-3 text-right',
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
        </ModelPage>
    );
};

export default ScheduledMaintenanceDelete;
