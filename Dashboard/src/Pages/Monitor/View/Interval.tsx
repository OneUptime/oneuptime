import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
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
import MonitoringIntrerval from '../../../Components/Form/Monitor/MonitorInterval';
import { JSONObject } from 'Common/Types/JSON';
import MonitoringIntervalElement from '../../../Components/Form/Monitor/MonitoringIntervalElement';

const MonitorCriteria: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

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
                        modelId
                    ),
                },
                {
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Monitor',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Criteria',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
              <CardModelDetail
                name="Monitoring Interval"
                editButtonText="Edit Monitoring Interval"
                cardProps={{
                    title: 'Monitoring Interval',
                    description: "Here is how often we will check your monitor status.",
                    icon: IconProp.Clock,
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            monitoringInterval: true,
                        },
                        
                        title: 'Monitoring Interval',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownOptions: MonitoringIntrerval,
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

        </ModelPage>
    );
};

export default MonitorCriteria;
