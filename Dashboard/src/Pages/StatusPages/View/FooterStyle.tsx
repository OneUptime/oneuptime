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
                    title: 'Footer',
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
                    title: 'Copyright Info',
                    description: 'Copyright info for your status page',
                    icon: IconProp.Text,
                }}
                isEditable={true}
                editButtonText={'Edit Copyright'}
                formFields={[
                    {
                        field: {
                            copyrightText: true,
                        },
                        title: 'Copyright Info',
                        fieldType: FormFieldSchemaType.Text,
                        required: false,
                        placeholder: 'Acme, Inc.',
                    }
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                copyrightText: true,
                            },
                            fieldType: FieldType.Text,
                            title: 'Copyright Info',
                            placeholder: 'No copyright info entered so far.',
                        }
                    ],
                    modelId: modelId,
                }}
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


            <CardModelDetail<StatusPage>
                cardProps={{
                    title: 'Footer Colors',
                    description: 'Footer background color and text colors for your status page',
                    icon: IconProp.Layers,
                }}
                editButtonText={'Edit Colors'}
                isEditable={true}
                formFields={[

                    {
                        field: {
                            footerBackgroundColor: true,
                        },
                        title: 'Footer Background Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: false,
                        placeholder: '#ffffff',
                    },
                    {
                        field: {
                            footerTextColor: true,
                        },
                        title: 'Footer Text Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: false,
                        placeholder: '#000000',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                footerBackgroundColor: true
                            },
                            fieldType: FieldType.Color,
                            title: 'Footer Background Color',
                            placeholder: '#ffffff',
                        },
                        {
                            field: {
                                footerTextColor: true
                            },
                            fieldType: FieldType.Color,
                            title: 'Footer Text Color',
                            placeholder: '#000000',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                cardProps={{
                    title: 'Advanced Footer Settings',
                    description: 'Advanced settings for your status page footer',
                    icon: IconProp.Settings,
                }}
                editButtonText={'Edit Settings'}
                isEditable={true}
                formFields={[

                    {
                        field: {
                            showFooter: true,
                        },
                        title: 'Show Footer on Status Page',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                    }
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                showFooter: true
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Show Footer on Status Page',
                        }
                    ],
                    modelId: modelId,
                }}
            />

        </Page>
    );
};

export default StatusPageDelete;
