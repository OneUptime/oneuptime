import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import IconProp from 'Common/Types/Icon/IconProp';
import CallLog from 'Model/Models/CallLog';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import DashboardNavigation from '../../Utils/Navigation';
import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import DashboardSideMenu from './SideMenu';
import Page from 'CommonUI/src/Components/Page/Page';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import CallStatus from 'Common/Types/Call/CallStatus';
import { Green, Red } from 'Common/Types/BrandColors';
import { BILLING_ENABLED } from 'CommonUI/src/Config';
import Column from 'CommonUI/src/Components/ModelTable/Column';
import Columns from 'CommonUI/src/Components/ModelTable/Columns';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';

const CallLogs: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showViewCallTextModal, setShowViewCallTextModal] =
        useState<boolean>(false);
    const [callText, setCallText] = useState<string>('');
    const [callModelTitle, setCallModalTitle] = useState<string>('');

    const modelTableColumns: Columns<CallLog> = [
        {
            field: {
                _id: true,
            },
            title: 'Log ID',
            type: FieldType.Text,
            isFilterable: true,
        },
        {
            field: {
                toNumber: true,
            },
            isFilterable: true,

            title: 'To Number',
            type: FieldType.Phone,
        },
        {
            field: {
                createdAt: true,
            },
            title: 'Sent at',
            type: FieldType.DateTime,
            isFilterable: true,
        },

        {
            field: {
                status: true,
            },
            title: 'Status',
            type: FieldType.Text,
            getElement: (item: JSONObject): ReactElement => {
                if (item['status']) {
                    return (
                        <Pill
                            isMinimal={false}
                            color={
                                item['status'] === CallStatus.Success
                                    ? Green
                                    : Red
                            }
                            text={item['status'] as string}
                        />
                    );
                }

                return <></>;
            },
            isFilterable: true,
        },
    ];

    if (BILLING_ENABLED) {
        modelTableColumns.push({
            field: {
                callCostInUSDCents: true,
            },
            title: 'Call Cost',
            type: FieldType.USDCents,
        } as Column<CallLog>);
    }

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
                    title: 'Call Logs',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_CALL_LOGS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <>
                <ModelTable<CallLog>
                    modelType={CallLog}
                    id="call-logs-table"
                    isDeleteable={false}
                    isEditable={false}
                    isCreateable={false}
                    name="Call Logs"
                    query={{
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    }}
                    selectMoreFields={{
                        callData: true,
                        statusMessage: true,
                    }}
                    actionButtons={[
                        {
                            title: 'View Call Text',
                            buttonStyleType: ButtonStyleType.NORMAL,
                            icon: IconProp.List,
                            onClick: async (
                                item: JSONObject,
                                onCompleteAction: Function
                            ) => {
                                setCallText(
                                    JSON.stringify(item['callData']) as string
                                );

                                setCallModalTitle('Call Text');
                                setShowViewCallTextModal(true);

                                onCompleteAction();
                            },
                        },
                        {
                            title: 'View Status Message',
                            buttonStyleType: ButtonStyleType.NORMAL,
                            icon: IconProp.Error,
                            onClick: async (
                                item: JSONObject,
                                onCompleteAction: Function
                            ) => {
                                setCallText(item['statusMessage'] as string);

                                setCallModalTitle('Status Message');
                                setShowViewCallTextModal(true);

                                onCompleteAction();
                            },
                        },
                    ]}
                    isViewable={false}
                    cardProps={{
                      
                        title: 'Call Logs',
                        description:
                            'Logs of all the Call sent by this project in the last 30 days.',
                    }}
                    noItemsMessage={
                        'Looks like no Call is sent by this project in the last 30 days.'
                    }
                    showRefreshButton={true}
                    showFilterButton={true}
                    columns={modelTableColumns}
                />

                {showViewCallTextModal && (
                    <ConfirmModal
                        title={callModelTitle}
                        description={
                            <div className="text-gray-500 mt-5 text-sm h-96 overflow-y-auto overflow-x-hidden p-5 border-gray-50 border border-2 bg-gray-100 rounded">
                                {callText}
                            </div>
                        }
                        onSubmit={() => {
                            setShowViewCallTextModal(false);
                        }}
                        submitButtonText="Close"
                        submitButtonType={ButtonStyleType.NORMAL}
                    />
                )}
            </>
        </Page>
    );
};

export default CallLogs;
