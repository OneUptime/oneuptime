import { JSONObject } from 'Common/Types/JSON';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import TelemetryUsageBilling from 'Model/Models/TelemetryUsageBilling';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import DashboardNavigation from '../../Utils/Navigation';
import Currency from 'Common/Types/Currency';
import DiskSize from 'Common/Types/DiskSize';
import Decimal from 'Common/Types/Decimal';
import TelemetryServiceElement from '../../Components/TelemetryService/TelemetryServiceElement';
import TelemetryService from 'Model/Models/TelemetryService';

export interface ComponentProps extends PageComponentProps {}

const Settings: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (
        <Fragment>
            <ModelTable<TelemetryUsageBilling>
                modelType={TelemetryUsageBilling}
                id="usage-history-table"
                isDeleteable={false}
                name="Settings > Billing > Usage History"
                isEditable={false}
                isCreateable={false}
                isViewable={false}
                cardProps={{
                    title: 'Telemetry Usage History',
                    description:
                        'Here is the telemetry usage history for this project. Please refer to the pricing page for more details.',
                }}
                noItemsMessage={
                    'No usage history found. Maybe you have not used Telemetry features yet?'
                }
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                showRefreshButton={true}
                showFilterButton={false}
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
                            dataIngestedInGB: true,
                        },
                        title: 'Data Ingested (in GB)',
                        type: FieldType.Text,
                        getElement: (item: JSONObject) => {
                            return (
                                <div>{`${DiskSize.convertToDecimalPlaces(
                                    (item['dataIngestedInGB'] as Decimal)
                                        .value as number
                                )} GB`}</div>
                            );
                        },
                    },
                    {
                        field: {
                            telemetryService: {
                                name: true,
                                _id: true,
                            },
                        },
                        title: 'Telemetry Service',
                        type: FieldType.Element,
                        getElement: (item: JSONObject) => {
                            return (
                                <TelemetryServiceElement telemetryService={item['telemetryService'] as TelemetryService} />
                            )
                        },
                    },
                    {
                        field: {
                            retainTelemetryDataForDays: true,
                        },
                        title: 'Data Retention (in Days)',
                        type: FieldType.Text,
                        getElement: (item: JSONObject) => {
                            return (
                                <div>{`${(item['retainTelemetryDataForDays']?.toString())
                                        
                                } Days`}</div>
                            );
                        },
                    },
                    {
                        field: {
                            dataIngestedInGB: true,
                        },
                        title: 'Data Ingested (in GB)',
                        type: FieldType.Text,
                        getElement: (item: JSONObject) => {
                            return (
                                <div>{`${DiskSize.convertToDecimalPlaces(
                                    (item['dataIngestedInGB'] as Decimal)
                                        .value as number
                                )} GB`}</div>
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
