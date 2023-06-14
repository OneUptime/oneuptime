import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Workflow from 'Model/Models/Workflow';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import IconProp from 'Common/Types/Icon/IconProp';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import LabelsElement from '../../../Components/Label/Labels';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Label from 'Model/Models/Label';

const Delete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(0);

    return (
        <ModelPage
            title="Workflow"
            modelType={Workflow}
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
                    title: 'Workflows',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Workflow',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Builder',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_BUILDER] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {/* StatusPage View  */}
            <CardModelDetail
                name="Workflow > Workflow Details"
                cardProps={{
                    title: 'Workflow Details',
                    description: "Here's more details for this workflow.",
                    icon: IconProp.Workflow,
                }}
                isEditable={true}
                formSteps={[
                    {
                        title: 'Workflow Info',
                        id: 'workflow-info',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        stepId: 'workflow-info',
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Status Page Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        stepId: 'workflow-info',
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            isEnabled: true,
                        },
                        title: 'Enabled',
                        stepId: 'workflow-info',
                        fieldType: FormFieldSchemaType.Toggle,
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
                    modelType: Workflow,
                    id: 'model-detail-workflow',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Workflow ID',
                        },
                        {
                            field: {
                                name: true,
                            },
                            title: 'Name',
                        },
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                        },
                        {
                            field: {
                                isEnabled: true,
                            },
                            title: 'Enabled',
                            fieldType: FieldType.Boolean,
                        },
                        {
                            field: {
                                labels: {
                                    name: true,
                                    color: true,
                                },
                            },
                            title: 'Labels',
                            type: FieldType.Text,
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
                    ],
                    modelId: modelId,
                }}
            />
        </ModelPage>
    );
};

export default Delete;
