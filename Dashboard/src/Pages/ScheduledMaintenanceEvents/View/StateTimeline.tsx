import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Color from 'Common/Types/Color';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Navigation from 'CommonUI/src/Utils/Navigation';
import OneUptimeDate from 'Common/Types/Date';
const ScheduledMaintenanceDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <ModelTable<ScheduledMaintenanceStateTimeline>
                modelType={ScheduledMaintenanceStateTimeline}
                id="table-scheduledMaintenance-status-timeline"
                name="Scheduled Maintenance Events > State Timeline"
                isDeleteable={true}
                isCreateable={true}
                showViewIdButton={true}
                isViewable={false}
                query={{
                    scheduledMaintenanceId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: ScheduledMaintenanceStateTimeline
                ): Promise<ScheduledMaintenanceStateTimeline> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.scheduledMaintenanceId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: 'Status Timeline',
                    description:
                        'Here is the status timeline for this Scheduled Maintenance',
                }}
                noItemsMessage={
                    'No status timeline created for this Scheduled Maintenance so far.'
                }
                formFields={[
                    {
                        field: {
                            scheduledMaintenanceState: true,
                        },
                        title: 'Scheduled Maintenance Status',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Scheduled Maintenance Status',
                        dropdownModal: {
                            type: ScheduledMaintenanceState,
                            labelField: 'name',
                            valueField: '_id',
                        },
                    },
                    {
                        field: {
                            shouldStatusPageSubscribersBeNotified: true,
                        },

                        title: 'Notify Status Page Subscribers',
                        description:
                            'Should status page subscribers be notified?',
                        fieldType: FormFieldSchemaType.Checkbox,
                        defaultValue: true,
                        required: false,
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                filters={[
                    {
                        field: {
                            scheduledMaintenanceState: {
                                name: true,
                            },
                        },
                        title: 'Scheduled Maintenance Status',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Starts At',
                        type: FieldType.DateTime,
                    },
                    {
                        field: {
                            endsAt: true,
                        },
                        title: 'Ends At',
                        type: FieldType.DateTime,
                    },
                    {
                        field: {
                            shouldStatusPageSubscribersBeNotified: true,
                        },
                        title: 'Subscribers Notified',
                        type: FieldType.Boolean,
                    },
                ]}
                columns={[
                    {
                        field: {
                            scheduledMaintenanceState: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Scheduled Maintenance Status',
                        type: FieldType.Text,
                        
                        getElement: (item: JSONObject): ReactElement => {
                            if (!item['scheduledMaintenanceState']) {
                                throw new BadDataException(
                                    'Scheduled Maintenance Status not found'
                                );
                            }

                            return (
                                <Pill
                                    color={
                                        (
                                            item[
                                                'scheduledMaintenanceState'
                                            ] as JSONObject
                                        )['color'] as Color
                                    }
                                    text={
                                        (
                                            item[
                                                'scheduledMaintenanceState'
                                            ] as JSONObject
                                        )['name'] as string
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Starts At',
                        type: FieldType.DateTime,
                    },
                    {
                        field: {
                            endsAt: true,
                        },
                        title: 'Ends At',
                        type: FieldType.DateTime,
                        noValueMessage: 'Currently Active',
                    },
                    {
                        field: {
                            endsAt: true,
                        },
                        title: 'Duration',
                        type: FieldType.Text,
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <p>
                                    {OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
                                        item['createdAt'] as Date,
                                        (item['endsAt'] as Date) ||
                                            OneUptimeDate.getCurrentDate()
                                    )}
                                </p>
                            );
                        },
                    },
                    {
                        field: {
                            shouldStatusPageSubscribersBeNotified: true,
                        },
                        title: 'Subscribers Notified',
                        type: FieldType.Boolean,
                    },
                ]}
            />
        </Fragment>
    );
};

export default ScheduledMaintenanceDelete;
