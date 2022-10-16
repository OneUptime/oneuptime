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
import StatusPagePreviewLink from './StatusPagePreviewLink';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import StatusPageHeaderLink from 'Model/Models/StatusPageHeaderLink';
import StatusPageFooterLink from 'Model/Models/StatusPageFooterLink';
import SortOrder from 'Common/Types/Database/SortOrder';
import BadDataException from 'Common/Types/Exception/BadDataException';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
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
                    title: 'Footer Style',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <StatusPagePreviewLink modelId={modelId} />
            <CardModelDetail<StatusPage>
                cardProps={{
                    title: 'Title and Description',
                    description: 'This will also be used for SEO.',
                    icon: IconProp.Text,
                }}
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
                cardProps={{
                    title: 'Logo, Cover and Favicon',
                    description: 'These will show up on your status page.',
                    icon: IconProp.Image,
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            logoFile: true,
                        },
                        title: 'Logo',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Please upload logo here.',
                    },
                    {
                        field: {
                            coverImageFile: true,
                        },
                        title: 'Cover',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Please cover logo here.',
                    },
                    {
                        field: {
                            faviconFile: true,
                        },
                        title: 'Favicon',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Please favicon logo here.',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                logoFile: {
                                    file: true,
                                    type: true,
                                },
                            },
                            fieldType: FieldType.ImageFile,
                            title: 'Logo',
                            placeholder: 'No logo uploaded.',
                        },
                        {
                            field: {
                                coverImageFile: {
                                    file: true,
                                    type: true,
                                },
                            },
                            fieldType: FieldType.ImageFile,
                            title: 'Cover Image',
                            placeholder: 'No cover uploaded.',
                        },
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


            <ModelTable<StatusPageHeaderLink>
                modelType={StatusPageHeaderLink}
                id="status-page-header-link"
                isDeleteable={true}
                sortBy="order"
                sortOrder={SortOrder.Ascending}
                isCreateable={true}
                isViewable={false}
                query={{
                    statusPageId: modelId,
                    projectId: props.currentProject?._id,
                }}
                enableDragAndDrop={true}
                dragDropIndexField="order"
                onBeforeCreate={(
                    item: StatusPageHeaderLink
                ): Promise<StatusPageHeaderLink> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.statusPageId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.Link,
                    title: 'Header Links',
                    description:
                        'Header Links for your status page',
                }}
                noItemsMessage={
                    'No status header link for this status page.'
                }
                formFields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Title',
                    },
                    {
                        field: {
                            link: true,
                        },
                        title: 'Link',
                        fieldType: FormFieldSchemaType.URL,
                        required: true,
                        placeholder: 'https://link.com',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            link: true,
                        },
                        title: 'Link',
                        type: FieldType.URL,
                        isFilterable: true,
                    },
                ]}
            />


            <ModelTable<StatusPageFooterLink>
                modelType={StatusPageFooterLink}
                id="status-page-Footer-link"
                isDeleteable={true}
                sortBy="order"
                sortOrder={SortOrder.Ascending}
                isCreateable={true}
                isViewable={false}
                query={{
                    statusPageId: modelId,
                    projectId: props.currentProject?._id,
                }}
                enableDragAndDrop={true}
                dragDropIndexField="order"
                onBeforeCreate={(
                    item: StatusPageFooterLink
                ): Promise<StatusPageFooterLink> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.statusPageId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.Link,
                    title: 'Footer Links',
                    description:
                        'Footer Links for your status page',
                }}
                noItemsMessage={
                    'No status footer link for this status page.'
                }
                formFields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Title',
                    },
                    {
                        field: {
                            link: true,
                        },
                        title: 'Link',
                        fieldType: FormFieldSchemaType.URL,
                        required: true,
                        placeholder: 'https://link.com',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            link: true,
                        },
                        title: 'Link',
                        type: FieldType.URL,
                        isFilterable: true,
                    },
                ]}
            />

        </Page>
    );
};

export default StatusPageDelete;
