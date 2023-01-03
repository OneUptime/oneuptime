import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Yellow } from 'Common/Types/BrandColors';
import { getAllEnvVars, BILLING_ENABLED } from 'CommonUI/src/Config';

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
                    title: 'Private Users',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS
                        ] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<StatusPagePrivateUser>
                modelType={StatusPagePrivateUser}
                id="status-page-group"
                name="Status Page > Private Users"
                isDeleteable={true}
                isCreateable={true}
                isViewable={false}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: StatusPagePrivateUser
                ): Promise<StatusPagePrivateUser> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.statusPageId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.User,
                    title: 'Private Users',
                    description:
                        'Here are a list of private users for this status page.',
                }}
                noItemsMessage={
                    'No private users created for this status page.'
                }
                formFields={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        placeholder: 'user@company.com',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                columns={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        type: FieldType.Email,
                        isFilterable: true,
                    },
                    {
                        field: {
                            password: true,
                        },
                        title: 'Status',
                        type: FieldType.Password,
                        isFilterable: false,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['password']) {
                                return (
                                    <Pill color={Green} text={'Signed up'} />
                                );
                            }
                            return <Pill color={Yellow} text={'Invite Sent'} />;
                        },
                    },
                ]}
                currentPlan={
                    BILLING_ENABLED
                        ? SubscriptionPlan.getPlanSelect(
                              props.currentProject?.paymentProviderPlanId!,
                              getAllEnvVars()
                          )
                        : undefined
                }
            />
        </Page>
    );
};

export default StatusPageDelete;
