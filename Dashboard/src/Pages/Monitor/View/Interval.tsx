import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import IconProp from 'Common/Types/Icon/IconProp';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import MonitoringInterval from '../../../Utils/MonitorIntervalDropdownOptions';
import { JSONObject } from 'Common/Types/JSON';
import MonitoringIntervalElement from '../../../Components/Monitor/MonitoringIntervalElement';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import useAsyncEffect from 'use-async-effect';

const MonitorCriteria: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [isLoading, setIsLoading] = useState<boolean>(true);

    const [error, setError] = useState<string>('');

    const fetchItem: () => Promise<void> = async (): Promise<void> => {
        // get item.
        setIsLoading(true);

        setError('');
        try {
            const item: Monitor | null = await ModelAPI.getItem(
                Monitor,
                modelId,
                {
                    monitorType: true,
                } as any,
                {}
            );

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

    const getPageContent: Function = (): ReactElement => {
        if (!monitorType || isLoading) {
            return <ComponentLoader />;
        }

        if (error) {
            return <ErrorMessage error={error} />;
        }

        if (monitorType === MonitorType.Manual) {
            return (
                <EmptyState
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
                            getElement: (item: JSONObject): ReactElement => {
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
        <ModelPage
            title="Monitor"
            modelType={Monitor}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Monitor',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Criteria',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <DisabledWarning monitorId={modelId} />
            {getPageContent()}
        </ModelPage>
    );
};

export default MonitorCriteria;
