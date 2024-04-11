import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Probe from 'Model/Models/Probe';
import { ErrorFunction, VoidFunction } from 'Common/Types/FunctionTypes';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { JSONObject } from 'Common/Types/JSON';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ProbeElement from 'CommonUI/src/Components/Probe/Probe';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import { Green, Red } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import URL from 'Common/Types/API/URL';
import { APP_API_URL } from 'CommonUI/src/Config';
import Banner from 'CommonUI/src/Components/Banner/Banner';
import ProbeStatusElement from '../../Components/Probe/ProbeStatus';
import Route from 'Common/Types/API/Route';

const ProbePage: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

    const [currentProbe, setCurrentProbe] = useState<JSONObject | null>(null);

    return (
        <Fragment>
            <>
                <ModelTable<Probe>
                    modelType={Probe}
                    id="probes-table"
                    name="Settings > Global Probes"
                    isDeleteable={false}
                    isEditable={false}
                    isCreateable={false}
                    cardProps={{
                        title: 'Global Probes',
                        description:
                            'Global Probes help you monitor external resources from different locations around the world.',
                    }}
                    fetchRequestOptions={{
                        overrideRequestUrl: URL.fromString(
                            APP_API_URL.toString()
                        ).addRoute('/probe/global-probes'),
                    }}
                    noItemsMessage={'No probes found.'}
                    showRefreshButton={true}
                    showFilterButton={true}
                    filters={[
                        {
                            field: {
                                name: true,
                            },
                            title: 'Name',
                            type: FieldType.Text,

                        },
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                            type: FieldType.Text,
                        },
                    ]}
                    columns={[
                        {
                            field: {
                                name: true,
                            },
                            title: 'Name',
                            type: FieldType.Text,
                            
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
                            
                        },
                        {
                            field: {
                                lastAlive: true,
                            },
                            title: 'Probe Status',
                            type: FieldType.Text,
                            
                            getElement: (item: JSONObject): ReactElement => {
                                return <ProbeStatusElement probe={item} />;
                            },
                        },
                    ]}
                />

                <Banner
                    openInNewTab={true}
                    title="Need help with setting up Custom Probes?"
                    description="Here is a guide which will help you get set up"
                    link={Route.fromString('/docs/probe/custom-probe')}
                />

                <ModelTable<Probe>
                    modelType={Probe}
                    query={{
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    }}
                    id="probes-table"
                    name="Settings > Probes"
                    isDeleteable={true}
                    isEditable={true}
                    isCreateable={true}
                    cardProps={{
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
                        {
                            field: {
                                shouldAutoEnableProbeOnNewMonitors: true,
                            },
                            title: 'Enable monitoring automatically on new monitors',
                            fieldType: FormFieldSchemaType.Toggle,
                            required: false,
                        },
                    ]}
                    showRefreshButton={true}
                    showFilterButton={true}
                    actionButtons={[
                        {
                            title: 'Show ID and Key',
                            buttonStyleType: ButtonStyleType.NORMAL,
                            onClick: async (
                                item: JSONObject,
                                onCompleteAction: VoidFunction,
                                onError: ErrorFunction
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
                    filters={[
                        {
                            field: {
                                name: true,
                            },
                            title: 'Name',
                            type: FieldType.Text,
                        },
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                            type: FieldType.Text,
                        },
                        {
                            field: {
                                shouldAutoEnableProbeOnNewMonitors: true,
                            },
                            title: 'Enable Monitoring by Default',
                            type: FieldType.Boolean,
                        }
                    ]}
                    
                    columns={[
                        {
                            field: {
                                name: true,
                            },
                            title: 'Name',
                            type: FieldType.Text,
                            
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
                            
                        },
                        {
                            field: {
                                shouldAutoEnableProbeOnNewMonitors: true,
                            },
                            title: 'Enable Monitoring by Default',
                            type: FieldType.Boolean,
                            
                        },
                        {
                            field: {
                                lastAlive: true,
                            },
                            title: 'Status',
                            type: FieldType.Text,
                           
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
            </>
        </Fragment>
    );
};

export default ProbePage;
