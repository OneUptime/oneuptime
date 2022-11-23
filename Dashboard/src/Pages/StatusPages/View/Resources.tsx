import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageResource from 'Model/Models/StatusPageResource';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import SortOrder from 'Common/Types/Database/SortOrder';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Monitor from 'Model/Models/Monitor';
import { JSONObject } from 'Common/Types/JSON';
import MonitorElement from '../../../Components/Monitor/Monitor';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import StatusPageGroup from 'Model/Models/StatusPageGroup';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import StatusPagePreviewLink from './StatusPagePreviewLink';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam(1)?.toString().substring(1) || ''
    );

    const [groups, setGroups] = useState<Array<StatusPageGroup>>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');

    const fetchGroups: Function = async () => {
        setError('');
        setIsLoading(true);

        try {
            const listResult: ListResult<StatusPageGroup> =
                await ModelAPI.getList<StatusPageGroup>(
                    StatusPageGroup,
                    {
                        statusPageId: modelId,
                        projectId: props.currentProject?.id,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        name: true,
                        _id: true,
                    },
                    {
                        order: SortOrder.Ascending,
                    },
                    {}
                );

            setGroups(listResult.data);
        } catch (err) {
            try {
                setError(
                    (err as HTTPErrorResponse).message ||
                        'Server Error. Please try again'
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
        }

        setIsLoading(false);
    };

    useEffect(() => {
        fetchGroups();
    }, []);

    const getModelTable: Function = (
        statusPageGroupId: ObjectID | null,
        statusPageGroupName: string | null
    ): ReactElement => {
        return (
            <ModelTable<StatusPageResource>
                modelType={StatusPageResource}
                id={`status-page-group-${statusPageGroupId?.toString() || ''}`}
                isDeleteable={true}
                sortBy="order"
                sortOrder={SortOrder.Ascending}
                isCreateable={true}
                isViewable={false}
                isEditable={true}
                query={{
                    statusPageId: modelId,
                    projectId: props.currentProject?._id,
                    statusPageGroupId: statusPageGroupId,
                }}
                enableDragAndDrop={true}
                dragDropIndexField="order"
                onBeforeCreate={(
                    item: StatusPageResource
                ): Promise<StatusPageResource> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.statusPageId = modelId;
                    item.projectId = props.currentProject.id;

                    if (statusPageGroupId) {
                        item.statusPageGroupId = statusPageGroupId;
                    }

                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.Activity,
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
                    'No status page reosurces created for this status page.'
                }
                formFields={[
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
                    },
                    {
                        field: {
                            displayName: true,
                        },
                        title: 'Display Name',
                        description:
                            'This will be the name that will be shown on the status page.',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Display Name',
                    },
                    {
                        field: {
                            displayDescription: true,
                        },
                        title: 'Description (Optional)',
                        fieldType: FormFieldSchemaType.LongText,
                        required: false,
                        description: 'This will be visible on the status page.',
                        placeholder: 'Display Description.',
                    },
                    {
                        field: {
                            displayTooltip: true,
                        },
                        title: 'Tooltip (Optional)',
                        fieldType: FormFieldSchemaType.LongText,
                        required: false,
                        description:
                            'This will show up as tooltip beside the resource on your status page.',
                        placeholder: 'Tooltip',
                    },
                    {
                        field: {
                            showCurrentStatus: true,
                        },
                        title: 'Show Current Resource Status',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                        defaultValue: true,
                        description:
                            'Current Resource Status will be shown beside this resource on your status page.',
                    },
                    {
                        field: {
                            showStatusHistoryChart: true,
                        },
                        title: 'Show Status History Chart',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                        description:
                            'Show resource status history for the past 90 days. ',
                        defaultValue: true,
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            monitor: {
                                name: true,
                                _id: true,
                                projectId: true,
                            },
                        },
                        title: 'Monitor',
                        type: FieldType.Entity,
                        isFilterable: true,
                        filterEntityType: Monitor,
                        filterQuery: {
                            projectId: props.currentProject?._id,
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <MonitorElement
                                    monitor={
                                        Monitor.fromJSON(
                                            (item['monitor'] as JSONObject) ||
                                                [],
                                            Monitor
                                        ) as Monitor
                                    }
                                />
                            );
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
                    {
                        field: {
                            displayDescription: true,
                        },
                        title: 'Display Description',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                ]}
            />
        );
    };

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
                    title: 'Resources',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <>
                <StatusPagePreviewLink modelId={modelId} />
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
        </Page>
    );
};

export default StatusPageDelete;
