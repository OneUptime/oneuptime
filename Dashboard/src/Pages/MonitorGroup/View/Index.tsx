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
import MonitorGroup from 'Model/Models/MonitorGroup';
import JSONFunctions from 'Common/Types/JSONFunctions';
import CurrentStatusElement from '../../../Components/MonitorGroup/CurrentStatus';
import Card from 'CommonUI/src/Components/Card/Card';
import MonitorUptimeGraph from 'CommonUI/src/Components/MonitorGraphs/Uptime';
import useAsyncEffect from 'use-async-effect';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import URL from 'Common/Types/API/URL';
import { DASHBOARD_API_URL } from 'CommonUI/src/Config';
import API from 'CommonUI/src/Utils/API/API';
import OneUptimeDate from 'Common/Types/Date';

const MonitorGroupView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    const [data, setData] = useState<Array<MonitorStatusTimeline>>([]);
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(true);

    useAsyncEffect(async () => {
        await fetchItem();
    }, []);

    const fetchItem: () => Promise<void> = async (): Promise<void> => {
        setIsLoading(true);
        setError('');

        try {
            const monitorStatus: ListResult<MonitorStatusTimeline> =
                await ModelAPI.getList(
                    MonitorStatusTimeline,
                    {},
                    LIMIT_PER_PROJECT,
                    0,
                    {},
                    {},
                    {
                        overrideRequestUrl: URL.fromString(
                            DASHBOARD_API_URL.toString()
                        )
                            .addRoute(new MonitorGroup().getCrudApiPath()!)
                            .addRoute('/timeline/')
                            .addRoute(`/${modelId.toString()}`),
                    }
                );

            setData(monitorStatus.data);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    return (
        <ModelPage
            title="Monitor Group"
            modelType={MonitorGroup}
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
                    title: 'Monitor Groups',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_GROUPS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Monitor Group',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_GROUP_VIEW] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {/* MonitorGroup View  */}
            <CardModelDetail<MonitorGroup>
                name="MonitorGroup Details"
                formSteps={[
                    {
                        title: 'Monitor Group Info',
                        id: 'monitor-info',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                cardProps={{
                    title: 'Monitor Group Details',
                    description:
                        'Here are more details for this monitor group.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        stepId: 'monitor-info',
                        title: 'Group Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Monitor Group Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        stepId: 'monitor-info',
                        title: 'Group Description',
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
                    showDetailsInNumberOfColumns: 2,
                    modelType: MonitorGroup,
                    id: 'model-detail-monitors',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Monitor Group ID',
                        },
                        {
                            field: {
                                name: true,
                            },
                            title: 'Monitor Group Name',
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
                        {
                            field: {
                                _id: true,
                            },
                            fieldType: FieldType.Element,
                            title: 'Current Status',
                            getElement: (): ReactElement => {
                                return (
                                    <CurrentStatusElement
                                        monitorGroupId={modelId}
                                    />
                                );
                            },
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <Card
                title="Uptime Graph"
                description="Here the 90 day uptime history of this monitor group."
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

export default MonitorGroupView;
