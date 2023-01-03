import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import NotNull from 'Common/Types/Database/NotNull';
import StatusPagePreviewLink from './StatusPagePreviewLink';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Red } from 'Common/Types/BrandColors';
// import NotNull from 'Common/Types/Database/NotNull';

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
                    title: 'Email Subscribers',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS
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
                id="table-subscriber"
                name="Status Page > Email Subscribers"
                isDeleteable={true}
                isCreateable={true}
                isEditable={false}
                isViewable={false}
                selectMoreFields={{
                    subscriberPhone: true,
                }}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId().toString(),
                    subscriberEmail: new NotNull(),
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
                    icon: IconProp.Email,
                    title: 'Email Subscribers',
                    description:
                        'Here are the list of subscribers who have subscribed to the status page.',
                }}
                noItemsMessage={'No subscribers found.'}
                formFields={[
                    {
                        field: {
                            subscriberEmail: true,
                        },
                        title: 'Email',
                        description:
                            'Status page updates will be sent to this email.',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        placeholder: 'subscriber@company.com',
                    },
                ]}
                showRefreshButton={true}
                viewPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            subscriberEmail: true,
                        },
                        title: 'Email',
                        type: FieldType.Email,
                    },
                    {
                        field: {
                            isUnsubscribed: true,
                        },
                        title: 'Status',
                        type: FieldType.Text,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['isUnsubscribed']) {
                                return (
                                    <Pill color={Red} text={'Unsubscribed'} />
                                );
                            }
                            return <Pill color={Green} text={'Subscribed'} />;
                        },
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
