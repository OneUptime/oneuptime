import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../../Utils/RouteMap';
import PageComponentProps from '../../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Service from 'Model/Models/Service';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import LabelsElement from '../../../../Components/Label/Labels';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Label from 'Model/Models/Label';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(0);

    return (
        <ModelPage
            title="Service"
            modelType={Service}
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
                    title: 'Telemetry',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TELEMETRY] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Services',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TELEMETRY_SERVICES] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Service',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TELEMETRY_SERVICES_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Overview',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TELEMETRY_SERVICES_VIEW] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {/* Service View  */}
            <CardModelDetail
                name="Service Details"
                formSteps={[
                    {
                        title: 'Service Info',
                        id: 'service-info',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                cardProps={{
                    title: 'Service Details',
                    description: 'Here are more details for this service.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        stepId: 'service-info',
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Service Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        stepId: 'service-info',
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
                    showDetailsInNumberOfColumns: 2,
                    modelType: Service,
                    id: 'model-detail-services',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Service ID',
                        },
                        {
                            field: {
                                name: true,
                            },
                            title: 'Service Name',
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
                                serviceToken: true,
                            },
                            title: 'Service Token',
                            fieldType: FieldType.HiddenText,
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </ModelPage>
    );
};

export default ServiceDelete;
