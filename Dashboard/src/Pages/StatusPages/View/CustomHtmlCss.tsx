import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

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
                {
                    title: 'Delete Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {/* StatusPage View  */}
            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Header HTML"
                cardProps={{
                    title: 'Header HTML',
                    description:
                        'You can include header HTML to your status page.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            headerHTML: true,
                        },
                        title: 'Header HTML',
                        fieldType: FormFieldSchemaType.HTML,
                        required: false,
                        placeholder: 'Insert Custom HTML here.',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                headerHTML: true,
                            },
                            fieldType: FieldType.HTML,
                            title: 'Header HTML',
                            placeholder:
                                'No Header HTML found. Please edit this Status Page to add some.',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            {/* StatusPage View  */}
            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Footer HTML"
                cardProps={{
                    title: 'Footer HTML',
                    description:
                        'You can include footer HTML to your status page.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            footerHTML: true,
                        },
                        title: 'Footer HTML',
                        fieldType: FormFieldSchemaType.HTML,
                        required: false,
                        placeholder: 'Insert Custom HTML here.',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                footerHTML: true,
                            },
                            fieldType: FieldType.HTML,
                            title: 'Footer HTML',
                            placeholder:
                                'No Footer HTML found. Please edit this Status Page to add some.',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            {/* StatusPage View  */}
            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Custom CSS"
                cardProps={{
                    title: 'Custom CSS',
                    description:
                        'You can include custom CSS classes to your status page.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            customCSS: true,
                        },
                        title: 'Custom CSS',
                        fieldType: FormFieldSchemaType.CSS,
                        required: false,
                        placeholder: 'Insert Custom CSS here.',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                customCSS: true,
                            },
                            fieldType: FieldType.CSS,
                            title: 'Custom CSS',
                            placeholder:
                                'No Custom CSS found. Please edit this Status Page to add some.',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            {/* StatusPage View  */}
            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Custom JavaScript"
                cardProps={{
                    title: 'Custom JavaScript',
                    description:
                        'You can include custom JavaScript classes to your status page.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            customJavaScript: true,
                        },
                        title: 'Custom JavaScript',
                        fieldType: FormFieldSchemaType.JavaScript,
                        required: false,
                        placeholder: 'Insert Custom JavaScript here.',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                customJavaScript: true,
                            },
                            fieldType: FieldType.JavaScript,
                            title: 'Custom JavaScript',
                            placeholder:
                                'No Custom JavaScript found. Please edit this Status Page to add some.',
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </ModelPage>
    );
};

export default StatusPageDelete;
