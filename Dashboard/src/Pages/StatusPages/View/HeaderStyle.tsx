import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import StatusPagePreviewLink from './StatusPagePreviewLink';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import StatusPageHeaderLink from 'Model/Models/StatusPageHeaderLink';
import SortOrder from 'Common/Types/Database/SortOrder';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Navigation from 'CommonUI/src/Utils/Navigation';
const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
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
                    title: 'Header',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_HEADER_STYLE
                        ] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <StatusPagePreviewLink modelId={modelId} />

            <CardModelDetail<StatusPage>
                name="Statusn Page > Branding > Header Style"
                cardProps={{
                    title: 'Logo, Cover and Favicon',
                    description: 'These will show up on your status page.',
                    icon: IconProp.Image,
                }}
                isEditable={true}
                editButtonText={'Edit Images'}
                formFields={[
                    {
                        field: {
                            logoFile: true,
                        },
                        title: 'Logo',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Upload logo',
                    },
                    {
                        field: {
                            coverImageFile: true,
                        },
                        title: 'Cover',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Upload cover image',
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
                    ],
                    modelId: modelId,
                }}
            />

            <ModelTable<StatusPageHeaderLink>
                modelType={StatusPageHeaderLink}
                id="status-page-header-link"
                name="Status Page > Header Links"
                isDeleteable={true}
                sortBy="order"
                sortOrder={SortOrder.Ascending}
                isCreateable={true}
                isViewable={false}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
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
                    description: 'Header Links for your status page',
                }}
                noItemsMessage={'No status header link for this status page.'}
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
                viewPageRoute={Navigation.getCurrentRoute()}
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
                name="Statusn Page > Branding > Header Colors"
                cardProps={{
                    title: 'Header Colors',
                    description:
                        'Header background color and text colors for your status page',
                    icon: IconProp.Layers,
                }}
                editButtonText={'Edit Colors'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            headerBackgroundColor: true,
                        },
                        title: 'Header Background Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: false,
                        placeholder: '#ffffff',
                    },
                    {
                        field: {
                            headerTextColor: true,
                        },
                        title: 'Header Text Color',
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
                                headerBackgroundColor: true,
                            },
                            fieldType: FieldType.Color,
                            title: 'Header Background Color',
                            placeholder: '#ffffff',
                        },
                        {
                            field: {
                                headerTextColor: true,
                            },
                            fieldType: FieldType.Color,
                            title: 'Header Text Color',
                            placeholder: '#000000',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Statusn Page > Branding > Cover Image Colors"
                cardProps={{
                    title: 'Cover Image Colors',
                    description:
                        'Banner background color color for your status page',
                    icon: IconProp.Layers,
                }}
                editButtonText={'Edit Colors'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            bannerBackgroundColor: true,
                        },
                        title: 'Cover Image Background Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: false,
                        placeholder: '#ffffff',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                bannerBackgroundColor: true,
                            },
                            fieldType: FieldType.Color,
                            title: 'Cover Image Background Color',
                            placeholder: '#ffffff',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Statusn Page > Branding > Advanced Header Settings"
                cardProps={{
                    title: 'Advanced Header Settings',
                    description:
                        'Advanced settings for your status page header',
                    icon: IconProp.Settings,
                }}
                editButtonText={'Edit Settings'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            showHeader: true,
                        },
                        title: 'Show Header on Status Page',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                showHeader: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Show Header on Status Page',
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Page>
    );
};

export default StatusPageDelete;
