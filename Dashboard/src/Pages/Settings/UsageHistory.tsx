import { JSONObject } from 'Common/Types/JSON';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import UsageBilling from 'Model/Models/UsageBilling';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import DashboardNavigation from '../../Utils/Navigation';
import Currency from 'Common/Types/Currency';
import DiskSize from 'Common/Types/DiskSize';
import Decimal from 'Common/Types/Decimal';

export interface ComponentProps extends PageComponentProps {}

const Settings: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (
        <Fragment>
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
                    description:
                        'Here is the usage history for this project. Please refer to the pricing page for more details.',
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
                                <div>{`${DiskSize.convertToDecimalPlaces(
                                    (item['usageCount'] as Decimal)
                                        .value as number
                                )} ${item['usageUnitName'] as string}`}</div>
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
                                <div>{`${Currency.convertToDecimalPlaces(
                                    (item['totalCostInUSD'] as Decimal)
                                        .value as number
                                )} USD`}</div>
                            );
                        },
                    },
                ]}
            />
        </Fragment>
    );
};

export default Settings;
