import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable, {
    ShowTableAs,
} from 'CommonUI/src/Components/ModelTable/ModelTable';
import MonitorStatus from 'Model/Models/MonitorStatus';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { JSONObject } from 'Common/Types/JSON';
import StatusBubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Color from 'Common/Types/Color';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import BadDataException from 'Common/Types/Exception/BadDataException';
import SortOrder from 'Common/Types/Database/SortOrder';
import DashboardNavigation from '../../Utils/Navigation';
const Monitors: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Settings',
                    to: RouteMap[PageMap.SETTINGS] as Route,
                },
                {
                    title: 'Monitors',
                    to: RouteMap[PageMap.SETTINGS_MONITORS_STATUS] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<MonitorStatus>
                modelType={MonitorStatus}
                query={{
                    projectId: DashboardNavigation.getProjectId().toString(),
                }}
                id="monitor-status-table"
                name="Settings > Monitor Status"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Activity,
                    title: 'Monitor Status',
                    description:
                        'Define different status types (eg: Operational, Degraded, Down) here.',
                }}
                noItemsMessage={'No monitor status found.'}
                orderedStatesListProps={{
                    titleField: 'name',
                    descriptionField: 'description',
                    orderField: 'priority',
                }}
                showTableAs={ShowTableAs.OrderedStatesList}
                onBeforeDelete={(item: MonitorStatus) => {
                    if (item.isOperationalState) {
                        throw new BadDataException(
                            'This monitor status cannot be deleted because its the operational state of monitors. Operational status or Offline Status cannnot be deleted.'
                        );
                    }

                    if (item.isOfflineState) {
                        throw new BadDataException(
                            'This monitor status cannot be deleted because its the offline state of monitors. Operational status or Offline Status cannnot be deleted.'
                        );
                    }

                    return item;
                }}
                viewPageRoute={props.pageRoute}
                onBeforeCreate={(
                    item: MonitorStatus
                ): Promise<MonitorStatus> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }

                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Operational',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Monitors are up and operating normally.',
                    },
                    {
                        field: {
                            color: true,
                        },
                        title: 'Monitor Status Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: true,
                        placeholder:
                            'Please select color for this monitor status.',
                    },
                ]}
                sortBy="priority"
                sortOrder={SortOrder.Ascending}
                showRefreshButton={true}
                selectMoreFields={{
                    color: true,
                    isOperationalState: true,
                    isOfflineState: true,
                    priority: true,
                }}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,

                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <StatusBubble
                                    color={item['color'] as Color}
                                    text={item['name'] as string}
                                />
                            );
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default Monitors;
