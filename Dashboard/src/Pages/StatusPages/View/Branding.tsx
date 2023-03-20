import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import IconProp from 'Common/Types/Icon/IconProp';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

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
                    title: 'Essential Branding',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_BRANDING] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <CardModelDetail<StatusPage>
                name="Statusn Page > Branding > Title and Description"
                cardProps={{
                    title: 'Title and Description',
                    description: 'This will also be used for SEO.',
                    icon: IconProp.Text,
                }}
                editButtonText={'Edit'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            pageTitle: true,
                        },
                        title: 'Page Title',
                        fieldType: FormFieldSchemaType.Text,
                        required: false,
                        placeholder: 'Please enter page title here.',
                    },
                    {
                        field: {
                            pageDescription: true,
                        },
                        title: 'Page Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: false,
                        placeholder: 'Please enter page description here.',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                pageTitle: true,
                            },
                            fieldType: FieldType.Text,
                            title: 'Page Title',
                            placeholder: 'No page title entered so far.',
                        },
                        {
                            field: {
                                pageDescription: true,
                            },
                            fieldType: FieldType.Text,
                            title: 'Page Description',
                            placeholder: 'No page description entered so far.',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Statusn Page > Branding > Favicon"
                cardProps={{
                    title: 'Favicon',
                    description: 'Favicon will be used for SEO.',
                    icon: IconProp.Image,
                }}
                isEditable={true}
                editButtonText={'Edit Favicon'}
                formFields={[
                    {
                        field: {
                            faviconFile: true,
                        },
                        title: 'Favicon',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Upload Favicon.',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                faviconFile: {
                                    file: true,
                                    type: true,
                                },
                            },
                            fieldType: FieldType.ImageFile,
                            title: 'Favicon',
                            placeholder: 'No favicon uploaded.',
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Page>
    );
};

export default StatusPageDelete;
