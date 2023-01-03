import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import NotNull from 'Common/Types/Database/NotNull';
import StatusPagePreviewLink from './StatusPagePreviewLink';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = DashboardNavigation.getProjectId()!;

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
                    title: 'Webhook Subscribers',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS
                        ] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <StatusPagePreviewLink modelId={modelId} />
            <ModelTable<StatusPageSubscriber>
                modelType={StatusPageSubscriber}
                name="Status Page > Webhook Subscribers"
                id="table-subscriber"
                isDeleteable={true}
                isCreateable={true}
                isEditable={false}
                isViewable={false}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId().toString(),
                    subscriberWebhook: new NotNull(),
                }}
                onBeforeCreate={(
                    item: StatusPageSubscriber
                ): Promise<StatusPageSubscriber> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }

                    item.statusPageId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.Webhook,
                    title: 'Webhook Subscribers',
                    description:
                        'Here are the list of subscribers who have subscribed to the status page.',
                }}
                noItemsMessage={'No subscribers found.'}
                formFields={[
                    {
                        field: {
                            subscriberWebhook: true,
                        },
                        title: 'Webhook URL',
                        description:
                            'A POST request will be sent to this webhook.',
                        fieldType: FormFieldSchemaType.URL,
                        required: true,
                        placeholder: 'URL',
                    },
                ]}
                showRefreshButton={true}
                viewPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            subscriberWebhook: true,
                        },
                        title: 'Webhook URL',
                        type: FieldType.URL,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Subscribed At',
                        type: FieldType.DateTime,
                    },
                ]}
            />
        </Page>
    );
};

export default StatusPageDelete;
