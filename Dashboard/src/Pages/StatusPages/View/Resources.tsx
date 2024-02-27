import BaseModel from 'Common/Models/BaseModel';
import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageComponentProps from '../../PageComponentProps';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageResource, {
    UptimePrecision,
} from 'Model/Models/StatusPageResource';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Monitor from 'Model/Models/Monitor';
import { JSONObject } from 'Common/Types/JSON';
import MonitorElement from '../../../Components/Monitor/Monitor';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import StatusPageGroup from 'Model/Models/StatusPageGroup';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import Navigation from 'CommonUI/src/Utils/Navigation';
import API from 'CommonUI/src/Utils/API/API';
import { ModelField } from 'CommonUI/src/Components/Forms/ModelForm';
import MonitorGroup from 'Model/Models/MonitorGroup';
import Link from 'CommonUI/src/Components/Link/Link';
import MonitorGroupElement from '../../../Components/MonitorGroup/MonitorGroupElement';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import { PromiseVoidFunction } from 'Common/Types/FunctionsTypes';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [groups, setGroups] = useState<Array<StatusPageGroup>>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');

    const [addMonitorGroup, setAddMonitorGroup] = useState<boolean>(false);

    const fetchGroups: PromiseVoidFunction = async (): Promise<void> => {
        setError('');
        setIsLoading(true);

        try {
            const listResult: ListResult<StatusPageGroup> =
                await ModelAPI.getList<StatusPageGroup>({
                    modelType: StatusPageGroup,
                    query: {
                        statusPageId: modelId,
                        projectId: props.currentProject?.id,
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    select: {
                        name: true,
                        _id: true,
                    },
                    sort: {
                        order: SortOrder.Ascending,
                    },
                    requestOptions: {},
                });

            setGroups(listResult.data);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    useEffect(() => {
        fetchGroups();
    }, []);

    const getFooterForMonitor: GetReactElementFunction =
        (): ReactElement => {
            if (props.currentProject?.isFeatureFlagMonitorGroupsEnabled) {
                if (!addMonitorGroup) {
                    return (
                        <Link
                            onClick={() => {
                                setAddMonitorGroup(true);
                            }}
                            className="mt-1 text-sm text-gray-500 underline"
                        >
                            <div>
                                <p> Add a Monitor Group instead. </p>
                            </div>
                        </Link>
                    );
                }
                return (
                    <Link
                        onClick={() => {
                            setAddMonitorGroup(false);
                        }}
                        className="mt-1 text-sm text-gray-500 underline"
                    >
                        <div>
                            <p> Add a Monitor instead. </p>
                        </div>
                    </Link>
                );
            }

            return <></>;
        };

    let formFields: Array<ModelField<StatusPageResource>> = [
        {
            field: {
                monitor: true,
            },
            title: 'Monitor',
            description:
                'Select monitor that will be shown on the status page.',
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
                type: Monitor,
                labelField: 'name',
                valueField: '_id',
            },
            required: true,
            placeholder: 'Select Monitor',
            stepId: 'monitor-details',
            footerElement: getFooterForMonitor(),
        },
    ];

    if (addMonitorGroup) {
        formFields = [
            {
                field: {
                    monitorGroup: true,
                },
                title: 'Monitor Group',
                description:
                    'Select monitor group that will be shown on the status page.',
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                    type: MonitorGroup,
                    labelField: 'name',
                    valueField: '_id',
                },
                required: true,
                placeholder: 'Select Monitor Group',
                stepId: 'monitor-details',
                footerElement: getFooterForMonitor(),
            },
        ];
    }

    formFields = formFields.concat([
        {
            field: {
                displayName: true,
            },
            title: 'Display Name',
            description:
                'This will be the name that will be shown on the status page',
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: 'Display Name',
            stepId: 'monitor-details',
        },
        {
            field: {
                displayDescription: true,
            },
            title: 'Description',
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            placeholder: '',
            stepId: 'monitor-details',
        },
        {
            field: {
                displayTooltip: true,
            },
            title: 'Tooltip ',
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            description:
                'This will show up as tooltip beside the resource on your status page.',
            placeholder: 'Tooltip',
            stepId: 'advanced',
        },
        {
            field: {
                showCurrentStatus: true,
            },
            title: 'Show Current Resource Status',
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description:
                'Current Resource Status will be shown beside this resource on your status page.',
            stepId: 'advanced',
        },
        {
            field: {
                showUptimePercent: true,
            },
            title: 'Show Uptime %',
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: false,
            description:
                'Show uptime percentage for the past 90 days beside this resource on your status page.',
            stepId: 'advanced',
        },
        {
            field: {
                uptimePercentPrecision: true,
            },
            stepId: 'advanced',
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(UptimePrecision),
            showIf: (item: FormValues<StatusPageResource>): boolean => {
                return Boolean(item.showUptimePercent);
            },
            title: 'Select Uptime Precision',
            defaultValue: UptimePrecision.ONE_DECIMAL,
            required: true,
        },
        {
            field: {
                showStatusHistoryChart: true,
            },
            title: 'Show Status History Chart',
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: 'Show resource status history for the past 90 days. ',
            defaultValue: true,
            stepId: 'advanced',
        },
    ]);

    const getModelTable: Function = (
        statusPageGroupId: ObjectID | null,
        statusPageGroupName: string | null
    ): ReactElement => {
        return (
            <ModelTable<StatusPageResource>
                modelType={StatusPageResource}
                id={`status-page-group-${statusPageGroupId?.toString() || ''}`}
                isDeleteable={true}
                name="Status Page > Resources"
                sortBy="order"
                showViewIdButton={true}
                sortOrder={SortOrder.Ascending}
                isCreateable={true}
                isViewable={false}
                isEditable={true}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    statusPageGroupId: statusPageGroupId,
                }}
                enableDragAndDrop={true}
                dragDropIndexField="order"
                onBeforeCreate={(
                    item: StatusPageResource
                ): Promise<StatusPageResource> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.statusPageId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);

                    if (statusPageGroupId) {
                        item.statusPageGroupId = statusPageGroupId;
                    }

                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: `${
                        statusPageGroupName
                            ? statusPageGroupName + ' - '
                            : groups.length > 0
                            ? 'Uncategorized - '
                            : ''
                    }Status Page Resources`,
                    description: 'Resources that will be shown on the page',
                }}
                noItemsMessage={
                    'No status page resources created for this status page.'
                }
                formSteps={[
                    {
                        title: 'Monitor Details',
                        id: 'monitor-details',
                    },
                    {
                        title: 'Advanced',
                        id: 'advanced',
                    },
                ]}
                formFields={formFields}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                selectMoreFields={{
                    monitorGroup: {
                        name: true,
                        _id: true,
                        projectId: true,
                    },
                }}
                columns={[
                    {
                        field: {
                            monitor: {
                                name: true,
                                _id: true,
                                projectId: true,
                            },
                        },
                        title: props.currentProject
                            ?.isFeatureFlagMonitorGroupsEnabled
                            ? 'Resource'
                            : 'Monitor',
                        type: FieldType.Entity,
                        isFilterable: true,
                        filterEntityType: Monitor,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['monitor']) {
                                return (
                                    <MonitorElement
                                        monitor={
                                            BaseModel.fromJSON(
                                                (item[
                                                    'monitor'
                                                ] as JSONObject) || [],
                                                Monitor
                                            ) as Monitor
                                        }
                                        showIcon={
                                            props.currentProject
                                                ?.isFeatureFlagMonitorGroupsEnabled ||
                                            false
                                        }
                                    />
                                );
                            }

                            if (item['monitorGroup']) {
                                return (
                                    <MonitorGroupElement
                                        monitorGroup={
                                            BaseModel.fromJSON(
                                                (item[
                                                    'monitorGroup'
                                                ] as JSONObject) || [],
                                                MonitorGroup
                                            ) as MonitorGroup
                                        }
                                        showIcon={
                                            props.currentProject
                                                ?.isFeatureFlagMonitorGroupsEnabled ||
                                            false
                                        }
                                    />
                                );
                            }

                            return <></>;
                        },
                    },
                    {
                        field: {
                            displayName: true,
                        },
                        title: 'Display Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                ]}
            />
        );
    };

    return (
        <Fragment>
            <>
                {isLoading ? <ComponentLoader /> : <></>}

                {error ? <ErrorMessage error={error} /> : <></>}

                {!isLoading && !error ? getModelTable(null, null) : <></>}

                {!isLoading && !error && groups && groups.length > 0 ? (
                    groups.map((group: StatusPageGroup) => {
                        return getModelTable(group.id, group.name || null);
                    })
                ) : (
                    <></>
                )}
            </>
        </Fragment>
    );
};

export default StatusPageDelete;
