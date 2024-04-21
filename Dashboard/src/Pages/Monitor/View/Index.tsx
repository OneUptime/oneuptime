import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import PageComponentProps from '../../PageComponentProps';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Label from 'Model/Models/Label';
import ObjectID from 'Common/Types/ObjectID';
import LabelsElement from '../../../Components/Label/Labels';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Monitor from 'Model/Models/Monitor';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Card from 'CommonUI/src/Components/Card/Card';
import MonitorUptimeGraph from 'CommonUI/src/Components/MonitorGraphs/Uptime';
import OneUptimeDate from 'Common/Types/Date';
import useAsyncEffect from 'use-async-effect';
import InBetween from 'Common/Types/BaseDatabase/InBetween';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import API from 'CommonUI/src/Utils/API/API';
import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import IncomingMonitorLink from '../../../Components/Monitor/IncomingRequestMonitor/IncomingMonitorLink';
import { Green, Gray500, Black } from 'Common/Types/BrandColors';
import UptimeUtil from 'CommonUI/src/Components/MonitorGraphs/UptimeUtil';
import MonitorStatus from 'Model/Models/MonitorStatus';
import { UptimePrecision } from 'Model/Models/StatusPageResource';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import ServerMonitorDocumentation from '../../../Components/Monitor/ServerMonitor/Documentation';
import ChartGroup, {
    Chart,
    ChartGroupInterval,
} from 'CommonUI/src/Components/Charts/ChartGroup/ChartGroup';
import MonitorMetricsByMinute from 'Model/AnalyticsModels/MonitorMetricsByMinute';
import AnalyticsModelAPI, {
    ListResult as AnalyticsListResult,
} from 'CommonUI/src/Utils/AnalyticsModelAPI/AnalyticsModelAPI';
import {
    CheckOn,
    CriteriaFilterUtil,
} from 'Common/Types/Monitor/CriteriaFilter';
import { GetReactElementFunction } from 'CommonUI/src/Types/FunctionTypes';
import { MonitorCharts } from '../../../Components/Monitor/MonitorCharts/MonitorChart';
import Probe from 'Model/Models/Probe';
import ProbeUtil from '../../../Utils/Probe';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';

const MonitorView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    const [statusTimelines, setStatusTimelines] = useState<
        Array<MonitorStatusTimeline>
    >([]);
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const [downTimeMonitorStatues, setDowntimeMonitorStatues] = useState<
        Array<MonitorStatus>
    >([]);
    const [currentMonitorStatus, setCurrentMonitorStatus] = useState<
        MonitorStatus | undefined
    >(undefined);

    const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
        undefined
    );

    const [monitorMetricsByMinute, setMonitorMetricsByMinute] = useState<
        Array<MonitorMetricsByMinute>
    >([]);

    const [shouldFetchMonitorMetrics, setShouldFetchMonitorMetrics] =
        useState<boolean>(false);

    const [monitor, setMonitor] = useState<Monitor | null>(null);

    const [probes, setProbes] = useState<Array<Probe>>([]);

    const getUptimePercent: () => ReactElement = (): ReactElement => {
        if (isLoading) {
            return <></>;
        }

        const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
            statusTimelines,
            UptimePrecision.THREE_DECIMAL,
            downTimeMonitorStatues
        );

        return (
            <div
                className="font-medium mt-5"
                style={{
                    color:
                        currentMonitorStatus?.color?.toString() ||
                        Green.toString(),
                }}
            >
                {uptimePercent}% uptime
            </div>
        );
    };

    useAsyncEffect(async () => {
        await fetchItem();
    }, []);

    const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
        setIsLoading(true);
        setError('');

        try {
            const monitorStatus: ListResult<MonitorStatusTimeline> =
                await ModelAPI.getList({
                    modelType: MonitorStatusTimeline,
                    query: {
                        createdAt: new InBetween(startDate, endDate),
                        monitorId: modelId,
                        projectId: ProjectUtil.getCurrentProjectId(),
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    select: {
                        createdAt: true,
                        monitorId: true,
                        monitorStatus: {
                            name: true,
                            color: true,
                            isOperationalState: true,
                            priority: true,
                        },
                    },
                    sort: {
                        createdAt: SortOrder.Ascending,
                    },
                });

            const item: Monitor | null = await ModelAPI.getItem({
                modelType: Monitor,
                id: modelId,
                select: {
                    monitorType: true,
                    currentMonitorStatus: {
                        name: true,
                        color: true,
                    },
                    incomingRequestSecretKey: true,
                    serverMonitorSecretKey: true,
                    serverMonitorRequestReceivedAt: true,
                    incomingRequestReceivedAt: true,
                },
            });

            setMonitor(item);

            const monitorStatuses: ListResult<MonitorStatus> =
                await ModelAPI.getList({
                    modelType: MonitorStatus,
                    query: {
                        projectId: ProjectUtil.getCurrentProjectId(),
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    select: {
                        _id: true,
                        priority: true,
                        isOperationalState: true,
                        name: true,
                        color: true,
                    },
                    sort: {
                        priority: SortOrder.Ascending,
                    },
                });

            let monitorMetricsByMinute: AnalyticsListResult<MonitorMetricsByMinute> =
                {
                    data: [],
                    count: 0,
                    limit: 0,
                    skip: 0,
                };

            if (!item) {
                setError(`Monitor not found`);
                return;
            }

            const shouldFetchMonitorMetrics: boolean =
                CriteriaFilterUtil.getTimeFiltersByMonitorType(
                    item.monitorType!
                ).length > 0;

            setShouldFetchMonitorMetrics(shouldFetchMonitorMetrics);

            if (shouldFetchMonitorMetrics) {
                monitorMetricsByMinute = await AnalyticsModelAPI.getList({
                    query: {
                        monitorId: modelId,
                    },
                    modelType: MonitorMetricsByMinute,
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    select: {
                        createdAt: true,
                        metricType: true,
                        metricValue: true,
                        miscData: true,
                    },
                    sort: {
                        createdAt: SortOrder.Descending,
                    },
                });
            }

            setMonitorType(item.monitorType);
            setCurrentMonitorStatus(item.currentMonitorStatus);
            setDowntimeMonitorStatues(
                monitorStatuses.data.filter((status: MonitorStatus) => {
                    return !status.isOperationalState;
                })
            );
            setStatusTimelines(monitorStatus.data);
            setMonitorMetricsByMinute(monitorMetricsByMinute.data.reverse());

            const isMonitoredByProbe: boolean =
                item.monitorType === MonitorType.Ping ||
                item.monitorType === MonitorType.IP ||
                item.monitorType === MonitorType.Website ||
                item.monitorType === MonitorType.API;

            if (isMonitoredByProbe) {
                // get a list of probes
                const probes: Array<Probe> = await ProbeUtil.getAllProbes();
                setProbes(probes);
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    const getMonitorMetricsChartGroup: GetReactElementFunction =
        (): ReactElement => {
            if (isLoading) {
                return <></>;
            }

            if (!shouldFetchMonitorMetrics) {
                return <></>;
            }

            const chartsByDataType: Array<CheckOn> =
                CriteriaFilterUtil.getTimeFiltersByMonitorType(monitorType!);

            const charts: Array<Chart> = MonitorCharts.getMonitorCharts({
                monitorMetricsByMinute: monitorMetricsByMinute,
                checkOns: chartsByDataType,
                probes: probes,
            });

            return (
                <ChartGroup
                    interval={ChartGroupInterval.ONE_HOUR}
                    charts={charts}
                />
            );
        };

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <Fragment>
            <DisabledWarning monitorId={modelId} />

            {/* Monitor View  */}
            <CardModelDetail<Monitor>
                name="Monitor Details"
                formSteps={[
                    {
                        title: 'Monitor Info',
                        id: 'monitor-info',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                cardProps={{
                    title: 'Monitor Details',
                    description: 'Here are more details for this monitor.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        stepId: 'monitor-info',
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Monitor Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        stepId: 'monitor-info',
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            labels: true,
                        },
                        stepId: 'labels',
                        title: 'Labels ',
                        description:
                            'Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Label,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Labels',
                    },
                ]}
                modelDetailProps={{
                    selectMoreFields: {
                        disableActiveMonitoring: true,
                    },
                    showDetailsInNumberOfColumns: 2,
                    modelType: Monitor,
                    id: 'model-detail-monitors',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Monitor ID',
                        },
                        {
                            field: {
                                name: true,
                            },
                            title: 'Monitor Name',
                        },
                        {
                            field: {
                                currentMonitorStatus: {
                                    color: true,
                                    name: true,
                                },
                            },
                            title: 'Current Status',
                            fieldType: FieldType.Element,
                            getElement: (item: Monitor): ReactElement => {
                                if (!item['currentMonitorStatus']) {
                                    throw new BadDataException(
                                        'Monitor Status not found'
                                    );
                                }

                                if (item && item['disableActiveMonitoring']) {
                                    return (
                                        <Statusbubble
                                            color={Gray500}
                                            text={'Disabled'}
                                            shouldAnimate={false}
                                        />
                                    );
                                }

                                return (
                                    <Statusbubble
                                        color={
                                            item.currentMonitorStatus.color ||
                                            Black
                                        }
                                        shouldAnimate={true}
                                        text={
                                            item.currentMonitorStatus.name ||
                                            'Unknown'
                                        }
                                    />
                                );
                            },
                        },

                        {
                            field: {
                                monitorType: true,
                            },
                            title: 'Monitor Type',
                        },
                        {
                            field: {
                                labels: {
                                    name: true,
                                    color: true,
                                },
                            },
                            title: 'Labels',
                            fieldType: FieldType.Element,
                            getElement: (item: Monitor): ReactElement => {
                                return (
                                    <LabelsElement
                                        labels={item['labels'] || []}
                                    />
                                );
                            },
                        },
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            {/* Heartbeat URL */}
            {monitorType === MonitorType.IncomingRequest &&
            monitor?.incomingRequestSecretKey &&
            !monitor.incomingRequestReceivedAt ? (
                <IncomingMonitorLink
                    secretKey={monitor?.incomingRequestSecretKey}
                />
            ) : (
                <></>
            )}

            {monitorType === MonitorType.Server &&
            monitor?.serverMonitorSecretKey &&
            !monitor.serverMonitorRequestReceivedAt ? (
                <ServerMonitorDocumentation
                    secretKey={monitor?.serverMonitorSecretKey}
                />
            ) : (
                <></>
            )}

            <Card
                title="Uptime Graph"
                description="Here the 90 day uptime history of this monitor."
                rightElement={getUptimePercent()}
            >
                <MonitorUptimeGraph
                    error={error}
                    items={statusTimelines}
                    startDate={OneUptimeDate.getSomeDaysAgo(90)}
                    endDate={OneUptimeDate.getCurrentDate()}
                    isLoading={isLoading}
                    defaultBarColor={Green}
                    downtimeMonitorStatuses={downTimeMonitorStatues}
                />
            </Card>

            {shouldFetchMonitorMetrics && getMonitorMetricsChartGroup()}
        </Fragment>
    );
};

export default MonitorView;
