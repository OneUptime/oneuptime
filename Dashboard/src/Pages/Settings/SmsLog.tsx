import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import IconProp from 'Common/Types/Icon/IconProp';
import SmsLog from 'Model/Models/WorkflowLog';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import DashboardNavigation from '../../Utils/Navigation';
import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Modal, { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import DashboardSideMenu from './SideMenu';

const SMSLogs: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {

    const [showViewSmsTextModal, setShowViewSmsTextModal] = useState<boolean>(false);
    const [smsText, setSmsText] = useState<string>('');

    return (
        <ModelPage
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
                    title: 'Call & SMS',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_CALL_SMS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <>
                <ModelTable<SmsLog>
                    modelType={SmsLog}
                    id="sms-logs-table"
                    isDeleteable={false}
                    isEditable={false}
                    isCreateable={false}
                    name="SMS Logs"
                    query={{
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    }}
                    selectMoreFields={{
                        smsText: true,
                    }}
                    actionButtons={[
                        {
                            title: 'View SMS Text',
                            buttonStyleType: ButtonStyleType.NORMAL,
                            icon: IconProp.List,
                            onClick: async (
                                item: JSONObject,
                                onCompleteAction: Function
                            ) => {
                                setSmsText(item['smsText'] as string);
                                setShowViewSmsTextModal(true);

                                onCompleteAction();
                            },
                        },
                    ]}
                    isViewable={false}
                    cardProps={{
                        icon: IconProp.Logs,
                        title: 'SMS Logs',
                        description:
                            'Logs of all the SMS sent by this project in the last 30 days.',
                    }}
                    noItemsMessage={
                        'Looks like no SMS is sent by this project in the last 30 days.'
                    }
                    showRefreshButton={true}
                    showFilterButton={true}
                    columns={[
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
                                fromNumber: true,
                            },
                            isFilterable: true,

                            title: 'From Number',
                            type: FieldType.Phone,
                            
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
                    ]}
                />

                {showViewSmsTextModal && (
                    <Modal
                        title={'SMS Text'}
                        description="Here are the contents of the SMS."
                        isLoading={false}
                        modalWidth={ModalWidth.Large}
                        onSubmit={() => {
                            setShowViewSmsTextModal(false);
                        }}
                        submitButtonText={'Close'}
                        submitButtonStyleType={ButtonStyleType.NORMAL}
                    >
                        <div className="text-gray-500 mt-5 text-sm h-96 overflow-y-auto overflow-x-hidden p-5 border-gray-50 border border-2 bg-gray-100 rounded">
                            
                            <div>{smsText}</div>;
                        
                        </div>
                    </Modal>
                )}
            </>
        </ModelPage>
    );
};

export default SMSLogs;
