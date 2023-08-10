import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Label from 'Model/Models/Label';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import LabelsElement from '../../../Components/Label/Labels';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Monitor from 'Model/Models/Monitor';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Color from 'Common/Types/Color';
import Card from 'CommonUI/src/Components/Card/Card';
import MonitorUptimeGraph from 'CommonUI/src/Components/MonitorGraphs/Uptime';
import OneUptimeDate from 'Common/Types/Date';
import useAsyncEffect from 'use-async-effect';
import InBetween from 'Common/Types/Database/InBetween';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/Database/SortOrder';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import JSONFunctions from 'Common/Types/JSONFunctions';
import API from 'CommonUI/src/Utils/API/API';
import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import IncomingMonitorLink from './IncomingMonitorLink';
import { Grey } from 'Common/Types/BrandColors';

const MonitorView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    const [data, setData] = useState<Array<MonitorStatusTimeline>>([]);
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
    const endDate: Date = OneUptimeDate.getCurrentDate();

    const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
        undefined
    );

    useAsyncEffect(async () => {
        await fetchItem();
    }, []);

    const fetchItem: Function = async (): Promise<void> => {
        setIsLoading(true);
        setError('');

        try {
            const monitorStatus: ListResult<MonitorStatusTimeline> =
                await ModelAPI.getList(
                    MonitorStatusTimeline,
                    {
                        createdAt: new InBetween(startDate, endDate),
                        monitorId: modelId,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        createdAt: true,
                        monitorId: true,
                        monitorStatus: {
                            name: true,
                            color: true,
                            priority: true,
                        },
                    },
                    {
                        createdAt: SortOrder.Ascending,
                    }
                );

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

            setData(monitorStatus.data);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
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
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <DisabledWarning monitorId={modelId} />
            {/* Monitor View  */}
            <CardModelDetail
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
                            type: FieldType.Text,
                            getElement: (item: JSONObject): ReactElement => {
                                if (!item['currentMonitorStatus']) {
                                    throw new BadDataException(
                                        'Monitor Status not found'
                                    );
                                }

                                if (item && item['disableActiveMonitoring']) {
                                    return (
                                        <Statusbubble
                                            color={Grey}
                                            text={'Disabled'}
                                        />
                                    );
                                }

                                return (
                                    <Statusbubble
                                        color={
                                            (
                                                item[
                                                    'currentMonitorStatus'
                                                ] as JSONObject
                                            )['color'] as Color
                                        }
                                        text={
                                            (
                                                item[
                                                    'currentMonitorStatus'
                                                ] as JSONObject
                                            )['name'] as string
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
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <LabelsElement
                                        labels={
                                            JSONFunctions.fromJSON(
                                                (item['labels'] as JSONArray) ||
                                                    [],
                                                Label
                                            ) as Array<Label>
                                        }
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
            {monitorType === MonitorType.IncomingRequest ? (
                <IncomingMonitorLink modelId={modelId} />
            ) : (
                <></>
            )}

            <Card
                title="Uptime Graph"
                description="Here the 90 day uptime history of this monitor."
            >
                <MonitorUptimeGraph
                    error={error}
                    items={data}
                    startDate={OneUptimeDate.getSomeDaysAgo(90)}
                    endDate={OneUptimeDate.getCurrentDate()}
                    isLoading={isLoading}
                />
            </Card>
        </ModelPage>
    );
};

export default MonitorView;
