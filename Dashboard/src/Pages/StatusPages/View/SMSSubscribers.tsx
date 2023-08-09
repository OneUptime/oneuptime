import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import NotNull from 'Common/Types/Database/NotNull';
import Navigation from 'CommonUI/src/Utils/Navigation';
import StatusPage from 'Model/Models/StatusPage';
const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
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
                    title: 'SMS Subscribers',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<StatusPageSubscriber>
                modelType={StatusPageSubscriber}
                id="table-subscriber"
                name="Status Page > SMS Subscribers"
                isDeleteable={true}
                isCreateable={true}
                isEditable={false}
                isViewable={false}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    subscriberPhone: new NotNull(),
                }}
                onBeforeCreate={(
                    item: StatusPageSubscriber
                ): Promise<StatusPageSubscriber> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }

                    item.statusPageId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: 'SMS Subscribers',
                    description:
                        'Here are the list of subscribers who have subscribed to the status page.',
                }}
                noItemsMessage={'No subscribers found.'}
                formFields={[
                    {
                        field: {
                            subscriberPhone: true,
                        },
                        title: 'Phone Number',
                        description: 'Phone number to send SMS to.',
                        fieldType: FormFieldSchemaType.Phone,
                        required: true,
                        placeholder: 'Phone Number',
                    },
                ]}
                showRefreshButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            subscriberPhone: true,
                        },
                        title: 'Phone Number',
                        type: FieldType.Text,
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
        </ModelPage>
    );
};

export default StatusPageDelete;
