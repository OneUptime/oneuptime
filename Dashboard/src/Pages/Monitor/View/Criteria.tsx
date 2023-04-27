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
import { JSONObject } from 'Common/Types/JSON';
import MonitoringIntervalElement from '../../../Components/Form/Monitor/MonitoringIntervalElement';
import { CustomElementProps, FormFieldStyleType } from 'CommonUI/src/Components/Forms/Types/Field';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import MonitorStepsType from 'Common/Types/Monitor/MonitorSteps';
import MonitorSteps from '../../../Components/Form/Monitor/MonitorSteps';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';

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
                name="Monitoring Criteria"
                editButtonText="Edit Monitoring Criteria"
                cardProps={{
                    title: 'Monitoring Criteria',
                    description: "Here is the criteria we use to monitor this resource.",
                    icon: IconProp.Criteria,
                }}
                createEditModalWidth={ModalWidth.Large}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            monitorSteps: true,
                        },
                        stepId: 'criteria',
                        styleType: FormFieldStyleType.Heading,
                        title: 'Monitor Details',
                        fieldType: FormFieldSchemaType.CustomComponent,
                        required: true,
                        customValidation: (values: FormValues<Monitor>) => {
                            return MonitorStepsType.getValidationError(
                                values.monitorSteps as MonitorStepsType,
                                values.monitorType as MonitorType
                            );
                        },
                        getCustomElement: (
                            value: FormValues<Monitor>,
                            props: CustomElementProps
                        ) => {
                            return (
                                <MonitorSteps
                                    {...props}
                                    monitorType={
                                        value.monitorType || MonitorType.Manual
                                    }
                                    error={''}
                                />
                            );
                        },
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
