import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import DashboardSideMenu from '../SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Probe from 'Model/Models/Probe';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import OneUptimeDate from 'Common/Types/Date';
import { Green, Red } from 'Common/Types/BrandColors';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import ProbeElement from 'CommonUI/src/Components/Probe/Probe';
import IsNull from 'Common/Types/Database/IsNull';
import Banner from 'CommonUI/src/Components/Banner/Banner';
import URL from 'Common/Types/API/URL';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import AdminModelAPI from '../../../Utils/ModelAPI';

const Settings: FunctionComponent = (): ReactElement => {
    const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

    const [currentProbe, setCurrentProbe] = useState<JSONObject | null>(null);

    return (
        <Page
            title={'Admin Settings'}
            breadcrumbLinks={[
                {
                    title: 'Admin Dashboard',
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
                    title: 'Global Probes',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_PROBES] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* Project Settings View  */}

            <Banner
                openInNewTab={true}
                title="Need help with setting up Global Probes?"
                description="Here is a guide which will help you get set up"
                link={URL.fromString(
                    'https://github.com/OneUptime/oneuptime/blob/master/Docs/Probe/CustomProbe.md'
                )}
            />

            <ModelTable<Probe>
                modelType={Probe}
                id="probes-table"
                name="Settings > Global Probes"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    title: 'Global Probes',
                    description:
                        'Global Probes help you monitor external resources from different locations around the world.',
                }}
                query={{
                    projectId: new IsNull(),
                    isGlobalProbe: true,
                }}
                modelAPI={AdminModelAPI}
                noItemsMessage={'No probes found.'}
                showRefreshButton={true}
                showFilterButton={true}
                onBeforeCreate={(item: Probe) => {
                    item.isGlobalProbe = true;
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
                        placeholder: 'internal-probe',
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
                        placeholder:
                            'This probe is to monitor all the internal services.',
                    },

                    {
                        field: {
                            iconFile: true,
                        },
                        title: 'Probe Logo',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Upload logo',
                    },
                ]}
                selectMoreFields={{
                    key: true,
                    iconFileId: true,
                }}
                actionButtons={[
                    {
                        title: 'Show ID and Key',
                        buttonStyleType: ButtonStyleType.NORMAL,
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: Function,
                            onError: (err: Error) => void
                        ) => {
                            try {
                                setCurrentProbe(item);
                                setShowKeyModal(true);

                                onCompleteAction();
                            } catch (err) {
                                onCompleteAction();
                                onError(err as Error);
                            }
                        },
                    },
                ]}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,
                        getElement: (item: JSONObject): ReactElement => {
                            return <ProbeElement probe={item} />;
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
                    {
                        field: {
                            lastAlive: true,
                        },
                        title: 'Status',
                        type: FieldType.Text,
                        isFilterable: false,
                        getElement: (item: JSONObject): ReactElement => {
                            if (
                                item &&
                                item['lastAlive'] &&
                                OneUptimeDate.getNumberOfMinutesBetweenDates(
                                    OneUptimeDate.fromString(
                                        item['lastAlive'] as string
                                    ),
                                    OneUptimeDate.getCurrentDate()
                                ) < 5
                            ) {
                                return (
                                    <Statusbubble
                                        text={'Connected'}
                                        color={Green}
                                        shouldAnimate={true}
                                    />
                                );
                            }

                            return (
                                <Statusbubble
                                    text={'Disconnected'}
                                    color={Red}
                                    shouldAnimate={false}
                                />
                            );
                        },
                    },
                ]}
            />

            {showKeyModal && currentProbe ? (
                <ConfirmModal
                    title={`Probe Key`}
                    description={
                        <div>
                            <span>
                                Here is your probe key. Please keep this a
                                secret.
                            </span>
                            <br />
                            <br />
                            <span>
                                <b>Probe ID: </b>{' '}
                                {currentProbe['_id']?.toString()}
                            </span>
                            <br />
                            <br />
                            <span>
                                <b>Probe Key: </b>{' '}
                                {currentProbe['key']?.toString()}
                            </span>
                        </div>
                    }
                    submitButtonText={'Close'}
                    submitButtonType={ButtonStyleType.NORMAL}
                    onSubmit={async () => {
                        setShowKeyModal(false);
                    }}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Settings;
