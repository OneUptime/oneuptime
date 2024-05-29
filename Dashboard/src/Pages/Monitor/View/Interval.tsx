import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import MonitoringIntervalElement from '../../../Components/Monitor/MonitoringIntervalElement';
import MonitoringInterval from '../../../Utils/MonitorIntervalDropdownOptions';
import PageComponentProps from '../../PageComponentProps';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import IconProp from 'Common/Types/Icon/IconProp';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ObjectID from 'Common/Types/ObjectID';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import { GetReactElementFunction } from 'CommonUI/src/Types/FunctionTypes';
import API from 'CommonUI/src/Utils/API/API';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Monitor from 'Model/Models/Monitor';
import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import useAsyncEffect from 'use-async-effect';

const MonitorCriteria: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [isLoading, setIsLoading] = useState<boolean>(true);

    const [error, setError] = useState<string>('');

    const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
        // get item.
        setIsLoading(true);

        setError('');
        try {
            const item: Monitor | null = await ModelAPI.getItem({
                modelType: Monitor,
                id: modelId,
                select: {
                    monitorType: true,
                },
            });

            if (!item) {
                setError(`Monitor not found`);

                return;
            }

            setMonitorType(item.monitorType);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }
        setIsLoading(false);
    };

    const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
        undefined
    );

    useAsyncEffect(async () => {
        // fetch the model
        await fetchItem();
    }, []);

    const getPageContent: GetReactElementFunction = (): ReactElement => {
        if (!monitorType || isLoading) {
            return <ComponentLoader />;
        }

        if (error) {
            return <ErrorMessage error={error} />;
        }

        if (monitorType === MonitorType.Manual) {
            return (
                <EmptyState
                    id="empty-state-monitoring-interval"
                    icon={IconProp.Clock}
                    title={'No Monitoring Interval for Manual Monitors'}
                    description={
                        <>
                            This is a manual monitor. It does not monitor
                            anything and so, it cannot have monitoring interval
                            set. You can have monitoring interval on other
                            monitor types.{' '}
                        </>
                    }
                />
            );
        }

        if (monitorType === MonitorType.IncomingRequest) {
            return (
                <EmptyState
                    id="empty-state-monitoring-interval"
                    icon={IconProp.Clock}
                    title={
                        'No Monitoring Interval for Incoming Request / Heartbeat Monitors'
                    }
                    description={
                        <>
                            This is a incoming request / heartbeat monitor.
                            Since OneUptime does not send an outbound request,
                            we do not need monitoring interval. You can have
                            monitoring interval on other monitor types.{' '}
                        </>
                    }
                />
            );
        }

        return (
            <CardModelDetail
                name="Monitoring Interval"
                editButtonText="Edit Monitoring Interval"
                cardProps={{
                    title: 'Monitoring Interval',
                    description:
                        'Here is how often we will check your monitor status.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            monitoringInterval: true,
                        },

                        title: 'Monitoring Interval',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownOptions: MonitoringInterval,
                        required: true,
                        placeholder: 'Monitoring Interval',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 2,
                    modelType: Monitor,
                    id: 'model-detail-monitors',
                    fields: [
                        {
                            field: {
                                monitoringInterval: true,
                            },
                            title: 'Monitoring Interval',
                            getElement: (item: Monitor): ReactElement => {
                                return (
                                    <MonitoringIntervalElement
                                        monitoringInterval={
                                            item['monitoringInterval'] as string
                                        }
                                    />
                                );
                            },
                        },
                    ],
                    modelId: modelId,
                }}
            />
        );
    };

    return (
        <Fragment>
            <DisabledWarning monitorId={modelId} />
            {getPageContent()}
        </Fragment>
    );
};

export default MonitorCriteria;
