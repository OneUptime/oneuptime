import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Probe from 'Model/Models/Probe';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { JSONObject } from 'Common/Types/JSON';
import IconProp from 'Common/Types/Icon/IconProp';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ProbeElement from '../../Components/Probe/Probe';

const ProbePage: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {

    const [showKeyModal, setShowKeyModal] =
        useState<boolean>(false);

    const [currentProbe, setCurrentProbe] = useState<JSONObject | null>(null);

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
                    title: 'Probes',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_PROBES] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >

            <>
                <ModelTable<Probe>
                    modelType={Probe}
                    query={{
                        projectId: DashboardNavigation.getProjectId()?.toString(),
                    }}
                    id="probes-table"
                    name="Settings > Probes"
                    isDeleteable={true}
                    isEditable={true}
                    isCreateable={true}
                    cardProps={{
                        icon: IconProp.Signal,
                        title: 'Custom Probes',
                        description:
                            'Custom Probes help you monitor internal resources that is behind your firewall.',
                    }}
                    selectMoreFields={{
                        key: true,
                        iconFileId: true,
                    }}
                    noItemsMessage={'No probes found.'}
                    viewPageRoute={Navigation.getCurrentRoute()}
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
                    showRefreshButton={true}
                    showFilterButton={true}
                    actionButtons={[
                        {
                            title: 'Show Probe Key',
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
                                return (
                                    <ProbeElement probe={item}/>
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
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Probe ID',
                            type: FieldType.Text,
                            isFilterable: true,
                        },
                    ]}
                />


                {showKeyModal && currentProbe ? (
                    <ConfirmModal
                        title={`Probe Key`}

                        description={
                            <div>
                                <span>
                                    Here is your probe key. Please keep this a secret.
                                </span>
                                <br />
                                <br />
                                <span>
                                    <b>Probe Key: </b> {currentProbe['key']?.toString()}
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
            </>

        </Page>
    );
};

export default ProbePage;
