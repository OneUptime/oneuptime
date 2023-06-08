import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import IconProp from 'Common/Types/Icon/IconProp';
import SmsLog from 'Model/Models/SmsLog';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import DashboardNavigation from '../../Utils/Navigation';
import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Modal, { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import DashboardSideMenu from './SideMenu';
import Page from 'CommonUI/src/Components/Page/Page';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import SmsStatus from 'Common/Types/SmsStatus';
import { Green, Red } from 'Common/Types/BrandColors';

const SMSLogs: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showViewSmsTextModal, setShowViewSmsTextModal] =
        useState<boolean>(false);
    const [smsText, setSmsText] = useState<string>('');
    const [smsModelTitle, setSmsModalTitle] = useState<string>('');
    const [smsModelDescription, setSmsModalDescription] = useState<string>('');

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
                        statusMessage: true,
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
                                setSmsModalDescription(
                                    'Contents of the SMS message'
                                );
                                setSmsModalTitle('SMS Text');
                                setShowViewSmsTextModal(true);

                                onCompleteAction();
                            },
                        },
                        {
                            title: 'View Error',
                            buttonStyleType: ButtonStyleType.NORMAL,
                            icon: IconProp.Error,
                            onClick: async (
                                item: JSONObject,
                                onCompleteAction: Function
                            ) => {
                                setSmsText(item['statusMessage'] as string);
                                setSmsModalDescription(
                                    'Here is more information about this message.'
                                );
                                setSmsModalTitle('Status Message');
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
                                smsCostInUSDCents: true,
                            },
                            title: 'SMS Cost',
                            type: FieldType.USDCents,
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
                                                item['status'] ===
                                                SmsStatus.Success
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
                    ]}
                />

                {showViewSmsTextModal && (
                    <Modal
                        title={smsModelTitle}
                        description={smsModelDescription}
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
        </Page>
    );
};

export default SMSLogs;
