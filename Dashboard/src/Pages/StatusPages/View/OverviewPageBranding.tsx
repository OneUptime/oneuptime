import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import StatusPageHistoryChartBarColorRule from 'Model/Models/StatusPageHistoryChartBarColorRule';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import DashboardNavigation from '../../../Utils/Navigation';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorStatus from 'Model/Models/MonitorStatus';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Overview Page"
                cardProps={{
                    title: 'Overview Page',
                    description:
                        'Essential branding elements for overview page.',
                }}
                isEditable={true}
                editButtonText={'Edit Branding'}
                formFields={[
                    {
                        field: {
                            overviewPageDescription: true,
                        },
                        title: 'Overview Page Description.',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: false,
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'overview-page-description',
                    fields: [
                        {
                            field: {
                                overviewPageDescription: true,
                            },
                            fieldType: FieldType.Markdown,
                            title: 'Overview Page Description',
                            placeholder: 'No description set.',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <ModelTable<StatusPageHistoryChartBarColorRule>
                modelType={StatusPageHistoryChartBarColorRule}
                id={`status-page-history-chart-bar-color-rules`}
                isDeleteable={true}
                name="Status Page > Branding > History Chart Bar Color Rules"
                sortBy="order"
                showViewIdButton={true}
                sortOrder={SortOrder.Ascending}
                isCreateable={true}
                isViewable={false}
                isEditable={true}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                enableDragAndDrop={true}
                dragDropIndexField="order"
                singularName="Rule"
                pluralName="Rules"
                onBeforeCreate={(
                    item: StatusPageHistoryChartBarColorRule
                ): Promise<StatusPageHistoryChartBarColorRule> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }

                    item.statusPageId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);

                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: `Rules for Bar Colors of History Chart`,
                    description: 'Rules for history chart bar colors.',
                }}
                noItemsMessage={
                    'No history chart bar color rules have been set. By default the lowest monitor state color of that particular day will be used.'
                }
                formFields={[
                    {
                        field: {
                            uptimePercentGreaterThanOrEqualTo: true,
                        },
                        title: 'When uptime % is greater than or equal to',
                        description:
                            'This rule will be applied when uptime is greater than or equal to this value.',
                        fieldType: FormFieldSchemaType.Number,
                        validation: {
                            minValue: 0,
                            maxValue: 100,
                        },
                        required: true,
                        placeholder: '90',
                    },
                    {
                        field: {
                            barColor: true,
                        },
                        title: 'Then, use this bar color',
                        fieldType: FormFieldSchemaType.Color,
                        required: true,
                        placeholder: 'No color set',
                    },
                    {
                        field: {
                            downtimeMonitorStatuses: true,
                        },
                        title: 'These monitor statuses are considered as downtime',
                        description:
                            'These monitor statuses will be considered as downtime.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: MonitorStatus,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Select monitor statuses',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            uptimePercentGreaterThanOrEqualTo: true,
                        },
                        title: 'When Uptime Percent >=',
                        type: FieldType.Percent,
                        isFilterable: false,
                    },
                    {
                        field: {
                            barColor: true,
                        },
                        title: 'Then, Bar Color is',
                        type: FieldType.Color,
                        isFilterable: false,
                    },
                ]}
            />

            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Default Bar Color"
                cardProps={{
                    title: 'Default Bar Color of the History Chart',
                    description:
                        'Bar color will be used for history chart when no data is set.',
                }}
                isEditable={true}
                editButtonText={'Edit Default Bar Color'}
                formFields={[
                    {
                        field: {
                            defaultBarColor: true,
                        },
                        title: 'Default Bar Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: true,
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'default-bar-color',
                    fields: [
                        {
                            field: {
                                defaultBarColor: true,
                            },
                            fieldType: FieldType.Color,
                            title: 'Default Bar Color',
                            placeholder: 'No color set.',
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Fragment>
    );
};

export default StatusPageDelete;
