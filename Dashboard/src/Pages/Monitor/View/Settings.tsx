import Route from 'Common/Types/API/Route';
import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import useAsyncEffect from 'use-async-effect';
import DuplicateModel from 'CommonUI/src/Components/DuplicateModel/DuplicateModel';
import { GetReactElementFunction } from 'CommonUI/src/Types/FunctionTypes';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import ResetObjectID from 'CommonUI/src/Components/ResetObjectID/ResetObjectID';

const MonitorCriteria: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [alertRefreshToggle, setAlertRefreshToggle] =
        useState<boolean>(false);

    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [isLoading, setIsLoading] = useState<boolean>(true);

    const [error, setError] = useState<string>('');

    const [monitor, setMonitor] = useState<Monitor | null>(null);

    const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
        // get item.
        setIsLoading(true);

        setError('');
        try {
            const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
                modelType: Monitor,
                id: modelId,
                select: {
                    monitorType: true,
                    incomingRequestSecretKey: true,
                    serverMonitorSecretKey: true,
                },
                requestOptions: {},
            });

            if (!monitor) {
                setError(`Monitor not found`);

                return;
            }

            setMonitor(monitor);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }
        setIsLoading(false);
    };

    useAsyncEffect(async () => {
        // fetch the model
        await fetchItem();
    }, []);

    const getPageContent: GetReactElementFunction = (): ReactElement => {
        if (!monitor?.monitorType || isLoading) {
            return <ComponentLoader />;
        }

        if (error) {
            return <ErrorMessage error={error} />;
        }

        return (
            <div>
                {monitor?.monitorType !== MonitorType.Manual && (
                    <CardModelDetail
                        name="Monitor Settings"
                        editButtonText="Edit Settings"
                        cardProps={{
                            title: 'Monitor Settings',
                            description:
                                'Here are some advanced settings for this monitor.',
                        }}
                        onSaveSuccess={() => {
                            setAlertRefreshToggle(!alertRefreshToggle);
                        }}
                        isEditable={true}
                        formFields={[
                            {
                                field: {
                                    disableActiveMonitoring: true,
                                },

                                title: 'Disable Active Monitoring',
                                fieldType: FormFieldSchemaType.Toggle,
                                required: false,
                            },
                        ]}
                        modelDetailProps={{
                            showDetailsInNumberOfColumns: 1,
                            modelType: Monitor,
                            id: 'model-detail-monitors',
                            fields: [
                                {
                                    field: {
                                        disableActiveMonitoring: true,
                                    },
                                    title: 'Disable Active Monitoring',
                                    fieldType: FieldType.Boolean,
                                },
                            ],
                            modelId: modelId,
                        }}
                    />
                )}

                {monitor?.monitorType === MonitorType.IncomingRequest ? (
                    <div className="mt-5">
                        <ResetObjectID<Monitor>
                            modelType={Monitor}
                            onUpdateComplete={async () => {
                                await fetchItem();
                            }}
                            fieldName={'incomingRequestSecretKey'}
                            title={'Reset Incoming Request Secret Key'}
                            description={`Your current incoming request secret key is: ${monitor.incomingRequestSecretKey?.toString()}. Resetting the secret key will generate a new key. Secret is used to authenticate incoming requests.`}
                            modelId={modelId}
                        />
                    </div>
                ) : (
                    <></>
                )}

                {monitor?.monitorType === MonitorType.Server ? (
                    <div className="mt-5">
                        <ResetObjectID<Monitor>
                            modelType={Monitor}
                            onUpdateComplete={async () => {
                                await fetchItem();
                            }}
                            fieldName={'serverMonitorSecretKey'}
                            title={'Reset Server Monitor Secret Key'}
                            description={`Your current server monitor secret key is: ${monitor.serverMonitorSecretKey?.toString()}. Resetting the secret key will generate a new key. Secret is used to authenticate monitoring agents deployed on the.`}
                            modelId={modelId}
                        />
                    </div>
                ) : (
                    <></>
                )}

                <div className="mt-5">
                    <DuplicateModel
                        modelId={modelId}
                        modelType={Monitor}
                        fieldsToDuplicate={{
                            description: true,
                            monitorType: true,
                            monitorSteps: true,
                            monitoringInterval: true,
                            labels: true,
                            customFields: true,
                        }}
                        navigateToOnSuccess={RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITORS] as Route
                        )}
                        fieldsToChange={[
                            {
                                field: {
                                    name: true,
                                },
                                title: 'New Monitor Name',
                                fieldType: FormFieldSchemaType.Text,
                                required: true,
                                placeholder: 'New Monitor Name',
                                validation: {
                                    minLength: 2,
                                },
                            },
                            {
                                field: {
                                    disableActiveMonitoring: true,
                                },
                                title: 'Disable Monitor',
                                description:
                                    'Should the new monitor be disabled when its duplicated?',
                                defaultValue: true,
                                fieldType: FormFieldSchemaType.Toggle,
                                required: false,
                            },
                        ]}
                    />
                </div>
            </div>
        );
    };

    return (
        <Fragment>
            <DisabledWarning
                monitorId={modelId}
                refreshToggle={alertRefreshToggle}
            />
            {getPageContent()}
        </Fragment>
    );
};

export default MonitorCriteria;
