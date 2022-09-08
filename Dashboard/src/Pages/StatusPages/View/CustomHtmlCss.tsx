import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam(1)?.toString().substring(1) || ''
    );

    return (
        <Page
            title={'Status Page'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Delete Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
           {/* StatusPage View  */}
           <CardModelDetail<StatusPage>
                cardProps={{
                    title: 'Header HTML',
                    description: "You can include header HTML to your status page.",
                    icon: IconProp.Code,
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
                    }
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
                            placeholder: 'No Header HTML found. Please edit this Status Page to add some.'
                        }
                    ],
                    modelId: modelId,
                }}
            />


             {/* StatusPage View  */}
           <CardModelDetail<StatusPage>
                cardProps={{
                    title: 'Footer HTML',
                    description: "You can include footer HTML to your status page.",
                    icon: IconProp.Code,
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
                            placeholder: 'No Footer HTML found. Please edit this Status Page to add some.'
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Page>
    );
};

export default StatusPageDelete;
