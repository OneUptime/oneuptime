import Route from 'Common/Types/API/Route';
import { JSONObject } from 'Common/Types/JSON';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import UsageBilling from 'Model/Models/UsageBilling';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import DashboardNavigation from '../../Utils/Navigation';

export interface ComponentProps extends PageComponentProps {}

const Settings: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
                {
                    title: 'Usage History',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_USAGE_HISTORY] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<UsageBilling>
                modelType={UsageBilling}
                id="usage-history-table"
                isDeleteable={false}
                name="Settings > Billing > Usage History"
                isEditable={false}
                isCreateable={false}
                isViewable={false}
                cardProps={{
                    title: 'Usage History',
                    description: 'Here is the usage history for this project.',
                }}
                noItemsMessage={
                    'No usage history found. Maybe you have not used Telemetry features yet?'
                }
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                showRefreshButton={true}
                showFilterButton={false}
                selectMoreFields={{
                    usageUnitName: true,
                }}
                columns={[
                    {
                        field: {
                            productType: true,
                        },
                        title: 'Product',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Day',
                        type: FieldType.Date,
                        isFilterable: true,
                    },
                    {
                        field: {
                            usageCount: true,
                        },
                        title: 'Usage',
                        type: FieldType.Text,
                        getElement: (item: JSONObject) => {
                            return (
                                <div>{`${item['usageCount'] as string} ${
                                    item['usageUnitName'] as string
                                }`}</div>
                            );
                        },
                    },
                    {
                        field: {
                            totalCostInUSD: true,
                        },
                        title: 'Total Cost',
                        type: FieldType.Text,
                        getElement: (item: JSONObject) => {
                            return (
                                <div>{`${
                                    item['totalCostInUSD'] as string
                                } USD`}</div>
                            );
                        },
                    },
                ]}
            />
        </Page>
    );
};

export default Settings;
