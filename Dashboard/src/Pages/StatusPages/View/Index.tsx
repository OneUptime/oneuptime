import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
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
import StatusPage from 'Model/Models/StatusPage';
import StatusPagePreviewLink from './StatusPagePreviewLink';
import JSONFunctions from 'Common/Types/JSONFunctions';

const StatusPageView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    return (
        <ModelPage
            title="Status Page"
            modelType={StatusPage}
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
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <StatusPagePreviewLink modelId={modelId} />

            {/* StatusPage View  */}
            <CardModelDetail
                name="Status Page > Status Page Details"
                cardProps={{
                    title: 'Status Page Details',
                    description: 'Here are more details for this status page.',
                }}
                formSteps={[
                    {
                        title: 'Status Page Info',
                        id: 'status-page-info',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        stepId: 'status-page-info',
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
                        stepId: 'status-page-info',
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels ',
                        stepId: 'labels',
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
                    modelType: StatusPage,
                    id: 'model-detail-monitors',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Status Page ID',
                        },
                        {
                            field: {
                                name: true,
                            },
                            title: 'Status Page Name',
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
        </ModelPage>
    );
};

export default StatusPageView;
